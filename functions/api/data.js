export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
    };

    const kv = env.HAWWA_KV || env.hawwa_kv || env.HAWWA_DB || env.hawwa_db;
    const adminSecret = env.ADMIN_PASSWORD;

    if (!kv) {
        return new Response(JSON.stringify({ error: "KV database is not connected." }), { status: 500, headers });
    }

    const url = new URL(request.url);

    // ==========================================
    // 1. GET REQUESTS
    // ==========================================
    if (request.method === "GET") {
        try {
            const suppliedPassword = request.headers.get("Authorization");
            const proofId = url.searchParams.get("proofId");

            // A. Fetch Specific Payment Proof (Admin Only)
            if (proofId) {
                if (!adminSecret || suppliedPassword?.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized access to proof." }), { status: 401, headers });
                }
                const proofData = await kv.get(`proof_${proofId}`);
                if (!proofData) {
                    return new Response(JSON.stringify({ error: "Proof document not found." }), { status: 404, headers });
                }
                return new Response(JSON.stringify({ success: true, proof: JSON.parse(proofData) }), { status: 200, headers });
            }

            // B. Admin Sign In
            if (suppliedPassword !== null && suppliedPassword !== "") {
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Invalid administrator password." }), { status: 401, headers });
                }

                const [publicStr, regStr, counterStr, recycledStr] = await Promise.all([
                    kv.get("public_state"),
                    kv.get("registrations"),
                    kv.get("student_counter"),
                    kv.get("recycled_numbers")
                ]);

                return new Response(JSON.stringify({
                    authenticated: true,
                    public: publicStr ? JSON.parse(publicStr) : null,
                    registrations: regStr ? JSON.parse(regStr) : [],
                    counter: counterStr ? parseInt(counterStr, 10) : 1,
                    recycledNumbers: recycledStr ? JSON.parse(recycledStr) : []
                }), { status: 200, headers });
            }

            // C. Public Visitor
            const publicStr = await kv.get("public_state");
            return new Response(JSON.stringify({
                authenticated: false,
                public: publicStr ? JSON.parse(publicStr) : null
            }), { status: 200, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Unable to load data." }), { status: 500, headers });
        }
    }

    // ==========================================
    // 2. POST REQUESTS
    // ==========================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // A. Student Submitting Multi-Course Registration
            if (body.action === "register") {
                const regData = body.data;
                if (!regData || !regData.fname || !regData.email || !regData.courses || regData.courses.length === 0) {
                    return new Response(JSON.stringify({ error: "Missing required details." }), { status: 400, headers });
                }

                let studentNumber;
                const recycledStr = await kv.get("recycled_numbers");
                let recycledList = recycledStr ? JSON.parse(recycledStr) : [];

                if (recycledList && recycledList.length > 0) {
                    studentNumber = recycledList.shift();
                    await kv.put("recycled_numbers", JSON.stringify(recycledList));
                } else {
                    const currentCounterStr = await kv.get("student_counter");
                    let counter = currentCounterStr ? parseInt(currentCounterStr, 10) : 1;
                    const currentYear = new Date().getFullYear().toString().slice(-2);
                    studentNumber = `HAW-${currentYear}${String(counter).padStart(4, '0')}`;
                    await kv.put("student_counter", String(counter + 1));
                }

                let hasProof = false;
                if (regData.paymentMethod === "EFT" && regData.proofFile) {
                    const proofRecord = {
                        studentNumber,
                        fileName: regData.proofFile.name || "receipt.pdf",
                        fileType: regData.proofFile.type || "application/octet-stream",
                        fileSize: regData.proofFile.size || "Unknown",
                        data: regData.proofFile.data,
                        uploadedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                    };
                    await kv.put(`proof_${studentNumber}`, JSON.stringify(proofRecord));
                    hasProof = true;
                }

                let paymentStatus = regData.paymentMethod === "EFT" 
                    ? (hasProof ? "payment_proof_received" : "awaiting_payment") 
                    : "awaiting_cash_payment";
                    
                let regStatus = regData.paymentMethod === "EFT" 
                    ? (hasProof ? "PAYMENT PROOF RECEIVED" : "AWAITING PAYMENT") 
                    : "CASH PAYMENT — AWAITING PAYMENT";

                const newRecord = {
                    studentNumber,
                    fname: regData.fname.trim(),
                    sname: regData.sname.trim(),
                    phone: regData.phone.trim(),
                    whatsapp: (regData.whatsapp || regData.phone).trim(),
                    email: regData.email.trim(),
                    address: (regData.address || "").trim(),
                    courses: regData.courses,
                    feeType: regData.feeType || "fixed",
                    totalFee: regData.totalFee || "R 0",
                    paymentMethod: regData.paymentMethod || "EFT",
                    paymentStatus,
                    status: regStatus,
                    hasProof,
                    notes: "",
                    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
                    timestamp: new Date().toISOString()
                };

                const existingRegsStr = await kv.get("registrations");
                const registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                registrations.unshift(newRecord);

                await kv.put("registrations", JSON.stringify(registrations));

                return new Response(JSON.stringify({
                    success: true,
                    studentNumber,
                    studentName: `${newRecord.fname} ${newRecord.sname}`,
                    courses: newRecord.courses,
                    totalFee: newRecord.totalFee,
                    date: newRecord.date
                }), { status: 200, headers });
            }

            // B. Admin Saving All System Content
            if (body.action === "adminSave") {
                const suppliedPassword = request.headers.get("Authorization") || "";
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });
                }

                const { registrations, ...publicData } = body.data;
                await kv.put("public_state", JSON.stringify(publicData));
                if (Array.isArray(registrations)) {
                    await kv.put("registrations", JSON.stringify(registrations));
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            // C. Admin Deleting Student Record (Recycles ID & Purges Proof)
            if (body.action === "deleteRegistration") {
                const suppliedPassword = request.headers.get("Authorization") || "";
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized: Invalid Password." }), { status: 401, headers });
                }

                const { studentNumber } = body.data;
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];

                registrations = registrations.filter(r => r.studentNumber !== studentNumber);
                await kv.put("registrations", JSON.stringify(registrations));
                await kv.delete(`proof_${studentNumber}`);

                const recycledStr = await kv.get("recycled_numbers");
                let recycledList = recycledStr ? JSON.parse(recycledStr) : [];
                if (!recycledList.includes(studentNumber)) {
                    recycledList.push(studentNumber);
                    await kv.put("recycled_numbers", JSON.stringify(recycledList));
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            // D. Admin Deleting Proof File Only (Keeps Student Intact)
            if (body.action === "deleteProofOnly") {
                const suppliedPassword = request.headers.get("Authorization") || "";
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized: Invalid Password." }), { status: 401, headers });
                }

                const { studentNumber } = body.data;
                await kv.delete(`proof_${studentNumber}`);

                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const idx = registrations.findIndex(r => r.studentNumber === studentNumber);
                if (idx !== -1) {
                    registrations[idx].hasProof = false;
                    registrations[idx].proofFile = null;
                    registrations[idx].paymentStatus = "awaiting_payment";
                    await kv.put("registrations", JSON.stringify(registrations));
                }

                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Server error." }), { status: 400, headers });
        }
    }

    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
                    }
