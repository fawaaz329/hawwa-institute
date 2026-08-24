export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
    };

    // Auto-connect to your Cloudflare KV binding
    const kv = env.HAWWA_KV || env.hawwa_kv || env.HAWWA_DB || env.hawwa_db;
    const adminSecret = env.ADMIN_PASSWORD;

    if (!kv) {
        return new Response(JSON.stringify({ error: "KV database is not connected." }), { status: 500, headers });
    }

    const url = new URL(request.url);

    // =========================================================================
    // 1. GET — PUBLIC DATA, ADMIN VERIFICATION & PROOF VIEWING
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

            // PUBLIC VISITOR
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
    // 2. POST — REGISTRATIONS, STATUS UPDATES & DELETION WITH SECURITY
    // =========================================================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // A. STUDENT SUBMITTING MULTI-COURSE REGISTRATION
            if (body.action === "register") {
                const regData = body.data;
                if (!regData || !regData.fname || !regData.email || !regData.courses || regData.courses.length === 0) {
                    return new Response(JSON.stringify({ error: "Missing required registration details." }), { status: 400, headers });
                }

                // Generate server-side sequential ID: HAW-260001
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
                    courses: regData.courses, // Array of selected course names
                    totalFee: regData.totalFee || "R 0",
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
                    courses: newRecord.courses,
                    totalFee: newRecord.totalFee
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

            // C. ADMIN DELETING/DEREGISTERING A STUDENT (PASSWORD PROTECTED)
            if (body.action === "deleteRegistration") {
                const suppliedPassword = request.headers.get("Authorization") || "";
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized: Invalid Admin Password." }), { status: 401, headers });
                }

                const { studentNumber } = body.data;
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];

                registrations = registrations.filter(r => r.studentNumber !== studentNumber);
                await kv.put("registrations", JSON.stringify(registrations));

                return new Response(JSON.stringify({ success: true, message: `Deregistered ${studentNumber}` }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Server error." }), { status: 400, headers });
        }
    }

    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
}
