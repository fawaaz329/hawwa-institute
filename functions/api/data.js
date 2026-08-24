export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
    };

    // Supports your KV binding seamlessly
    const kv = env.HAWWA_KV || env.hawwa_kv || env.HAWWA_DB || env.hawwa_db;
    const adminSecret = env.ADMIN_PASSWORD;

    if (!kv) {
        return new Response(JSON.stringify({ error: "KV binding is not connected." }), { status: 500, headers });
    }

    // =========================================================================
    // 1. GET — LOAD PUBLIC CONTENT OR AUTHENTICATE ADMIN
    // =========================================================================
    if (request.method === "GET") {
        try {
            const suppliedPassword = request.headers.get("Authorization");

            // ADMIN REQUEST: Must match ADMIN_PASSWORD exactly
            if (suppliedPassword !== null && suppliedPassword !== "") {
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Invalid administrator password." }), { status: 401, headers });
                }

                const [publicStr, regStr, counterStr] = await Promise.all([
                    kv.get("public_state"),
                    kv.get("registrations"),
                    kv.get("student_counter")
                ]);

                return new Response(JSON.stringify({
                    authenticated: true,
                    public: publicStr ? JSON.parse(publicStr) : null,
                    registrations: regStr ? JSON.parse(regStr) : [],
                    counter: counterStr ? parseInt(counterStr, 10) : 1
                }), { status: 200, headers });
            }

            // PUBLIC VISITOR: Return public site data only
            const publicStr = await kv.get("public_state");
            return new Response(JSON.stringify({
                authenticated: false,
                public: publicStr ? JSON.parse(publicStr) : null
            }), { status: 200, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Unable to load data." }), { status: 500, headers });
        }
    }

    // =========================================================================
    // 2. POST — STUDENT REGISTRATIONS & ADMIN SAVES
    // =========================================================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // A. STUDENT SUBMITTING MULTI-STEP REGISTRATION
            if (body.action === "register") {
                const regData = body.data;
                if (!regData || !regData.fname || !regData.email || !regData.course) {
                    return new Response(JSON.stringify({ error: "Missing required registration details." }), { status: 400, headers });
                }

                // Generate server-side student ID: HAW-260001
                const currentCounterStr = await kv.get("student_counter");
                let counter = currentCounterStr ? parseInt(currentCounterStr, 10) : 1;
                const currentYear = new Date().getFullYear().toString().slice(-2);
                const studentNumber = `HAW-${currentYear}${String(counter).padStart(4, '0')}`;
                await kv.put("student_counter", String(counter + 1));

                let paymentStatus = regData.paymentMethod === "EFT" 
                    ? (regData.proofFile ? "payment_proof_received" : "awaiting_payment") 
                    : "awaiting_cash_payment";
                    
                let regStatus = regData.paymentMethod === "EFT" 
                    ? (regData.proofFile ? "PAYMENT PROOF RECEIVED" : "AWAITING PAYMENT") 
                    : "CASH PAYMENT — AWAITING PAYMENT";

                const newRecord = {
                    studentNumber,
                    fname: regData.fname.trim(),
                    sname: regData.sname.trim(),
                    preferredName: (regData.preferredName || "").trim(),
                    idNumber: (regData.idNumber || "").trim(),
                    dob: regData.dob || "",
                    gender: regData.gender || "",
                    phone: regData.phone.trim(),
                    whatsapp: (regData.whatsapp || regData.phone).trim(),
                    email: regData.email.trim(),
                    address: (regData.address || "").trim(),
                    course: regData.course,
                    courseFee: regData.courseFee || "Configured Fee",
                    paymentMethod: regData.paymentMethod || "EFT",
                    paymentStatus,
                    status: regStatus,
                    proofFile: regData.proofFile || null,
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
                    course: newRecord.course
                }), { status: 200, headers });
            }

            // B. ADMIN SAVING ALL SYSTEM CONTENT
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

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Server error." }), { status: 400, headers });
        }
    }

    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
                        }
