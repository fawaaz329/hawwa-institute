async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "hawwa_secure_salt_2026");
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64ToUint8Array(base64Str) {
    const base64 = base64Str.includes(',') ? base64Str.split(',')[1] : base64Str;
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
}

export async function onRequest(context) {
    const { request, env } = context;
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate" };

    const kv = env.HAWWA_KV || env.hawwa_kv || env.HAWWA_DB || env.hawwa_db;
    const r2 = env.HAWWA_FILES;
    const adminSecret = env.ADMIN_PASSWORD;

    if (!kv) return new Response(JSON.stringify({ error: "KV database is not connected." }), { status: 500, headers });

    const url = new URL(request.url);

    if (request.method === "GET") {
        try {
            const suppliedPassword = request.headers.get("Authorization");
            const fileKey = url.searchParams.get("fileKey");
            const proofId = url.searchParams.get("proofId");
            const studentToken = request.headers.get("X-Student-Token");

            // R2 File Download
            if (fileKey) {
                let isAuth = false;
                if (suppliedPassword && suppliedPassword.trim() === adminSecret) isAuth = true;
                else if (studentToken) {
                    const sess = await kv.get(`session_${studentToken}`);
                    if (sess && fileKey.includes(JSON.parse(sess).studentNumber)) isAuth = true;
                }
                if (!isAuth) return new Response("Unauthorized", { status: 401 });
                if (r2) {
                    const obj = await r2.get(fileKey);
                    if (obj) {
                        const h = new Headers(); obj.writeHttpMetadata(h); h.set("etag", obj.httpEtag);
                        return new Response(obj.body, { headers: h });
                    }
                }
                return new Response("File not found", { status: 404 });
            }

            // Fetch Proof (Admin)
            if (proofId) {
                if (!adminSecret || suppliedPassword?.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });
                const p = await kv.get(`proof_${proofId}`);
                if (!p) return new Response(JSON.stringify({ error: "Proof not found." }), { status: 404, headers });
                return new Response(JSON.stringify({ success: true, proof: JSON.parse(p) }), { status: 200, headers });
            }

            // Student Portal Fetch
            if (studentToken) {
                const sess = await kv.get(`session_${studentToken}`);
                if (!sess) return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
                const { studentNumber } = JSON.parse(sess);
                const regsStr = await kv.get("registrations");
                const student = (regsStr ? JSON.parse(regsStr) : []).find(r => r.studentNumber === studentNumber);
                const invStr = await kv.get(`invoices_${studentNumber}`);
                return new Response(JSON.stringify({ authenticated: true, student, invoices: invStr ? JSON.parse(invStr) : [] }), { status: 200, headers });
            }

            // Admin Authentication
            if (suppliedPassword !== null && suppliedPassword !== "") {
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Invalid password." }), { status: 401, headers });
                const [pub, reg] = await Promise.all([kv.get("public_state"), kv.get("registrations")]);
                return new Response(JSON.stringify({ authenticated: true, public: pub ? JSON.parse(pub) : null, registrations: reg ? JSON.parse(reg) : [] }), { status: 200, headers });
            }

            // Public Visitor
            const pub = await kv.get("public_state");
            return new Response(JSON.stringify({ authenticated: false, public: pub ? JSON.parse(pub) : null }), { status: 200, headers });

        } catch (error) { return new Response(JSON.stringify({ error: "Server error." }), { status: 500, headers }); }
    }

    if (request.method === "POST") {
        try {
            const body = await request.json();

            // Register Student
            if (body.action === "register") {
                const rData = body.data;
                const cStr = await kv.get("student_counter");
                let count = cStr ? parseInt(cStr, 10) : 1;
                const sNum = `HAW-${new Date().getFullYear().toString().slice(-2)}${String(count).padStart(4, '0')}`;
                await kv.put("student_counter", String(count + 1));

                let hasProof = false;
                if (rData.paymentMethod === "EFT" && rData.proofFile) {
                    await kv.put(`proof_${sNum}`, JSON.stringify({ studentNumber: sNum, fileName: rData.proofFile.name, fileType: rData.proofFile.type, data: rData.proofFile.data, uploadedAt: new Date().toISOString() }));
                    hasProof = true;
                }

                const nRec = {
                    studentNumber: sNum, fname: rData.fname, sname: rData.sname, phone: rData.phone, whatsapp: rData.whatsapp, email: rData.email, address: rData.address,
                    courses: rData.courses, paymentPlan: rData.paymentPlan || "Not Selected", totalFee: rData.totalFee, paymentMethod: rData.paymentMethod,
                    paymentStatus: rData.paymentMethod === "EFT" ? (hasProof ? "payment_proof_received" : "awaiting_payment") : "awaiting_cash_payment",
                    status: rData.paymentMethod === "EFT" ? (hasProof ? "PAYMENT PROOF RECEIVED" : "AWAITING PAYMENT") : "CASH PAYMENT — AWAITING PAYMENT",
                    hasProof, portalAccess: false, paymentHistory: [], date: new Date().toLocaleDateString("en-GB")
                };

                const exRegStr = await kv.get("registrations");
                const regs = exRegStr ? JSON.parse(exRegStr) : [];
                regs.unshift(nRec);
                await kv.put("registrations", JSON.stringify(regs));
                return new Response(JSON.stringify({ success: true, studentNumber: sNum, date: nRec.date }), { status: 200, headers });
            }

            // Student Portal Auth
            if (body.action === "studentLogin") {
                const { studentNumber, password } = body.data;
                const regsStr = await kv.get("registrations");
                const student = (regsStr ? JSON.parse(regsStr) : []).find(r => r.studentNumber === studentNumber.trim().toUpperCase());
                if (!student || !student.portalAccess || !student.passwordHash) return new Response(JSON.stringify({ error: "Access disabled." }), { status: 401, headers });
                const attemptHash = await hashPassword(password);
                if (attemptHash !== student.passwordHash) return new Response(JSON.stringify({ error: "Incorrect password." }), { status: 401, headers });
                const token = crypto.randomUUID();
                await kv.put(`session_${token}`, JSON.stringify({ studentNumber: student.studentNumber }), { expirationTtl: 86400 });
                return new Response(JSON.stringify({ success: true, token }), { status: 200, headers });
            }

            if (body.action === "studentLogout") {
                const t = request.headers.get("X-Student-Token");
                if (t) await kv.delete(`session_${t}`);
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            // Admin Actions
            const suppliedPassword = request.headers.get("Authorization") || "";
            if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });

            if (body.action === "adminSave") {
                const { registrations, ...pData } = body.data;
                await kv.put("public_state", JSON.stringify(pData));
                if (Array.isArray(registrations)) await kv.put("registrations", JSON.stringify(registrations));
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            if (body.action === "updateRegistrationStatus") {
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const idx = registrations.findIndex(r => r.studentNumber === body.data.studentNumber);
                if (idx !== -1) {
                    registrations[idx].status = body.data.status;
                    await kv.put("registrations", JSON.stringify(registrations));
                    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
                }
            }

            if (body.action === "adminEnablePortal") {
                const exRegStr = await kv.get("registrations");
                let regs = exRegStr ? JSON.parse(exRegStr) : [];
                const idx = regs.findIndex(r => r.studentNumber === body.data.studentNumber);
                if (idx !== -1) {
                    const temp = Math.random().toString(36).slice(-6).toUpperCase();
                    regs[idx].portalAccess = true;
                    regs[idx].passwordHash = await hashPassword(temp);
                    await kv.put("registrations", JSON.stringify(regs));
                    return new Response(JSON.stringify({ success: true, tempPassword: temp }), { status: 200, headers });
                }
            }

            if (body.action === "adminDisablePortal") {
                const exRegStr = await kv.get("registrations");
                let regs = exRegStr ? JSON.parse(exRegStr) : [];
                const idx = regs.findIndex(r => r.studentNumber === body.data.studentNumber);
                if (idx !== -1) {
                    regs[idx].portalAccess = false;
                    await kv.put("registrations", JSON.stringify(regs));
                    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
                }
            }

            if (body.action === "adminUploadInvoice") {
                const { studentNumber, type, amount, date, fileData, fileType, fileName } = body.data;
                const invoiceId = `INV-${Date.now()}`;
                let fileKey = null;
                if (fileData && r2) {
                    fileKey = `invoices/${studentNumber}/${invoiceId}_${fileName}`;
                    await r2.put(fileKey, base64ToUint8Array(fileData), { httpMetadata: { contentType: fileType } });
                }
                const invStr = await kv.get(`invoices_${studentNumber}`);
                const invoices = invStr ? JSON.parse(invStr) : [];
                invoices.unshift({ invoiceId, studentNumber, type, amount, date, fileKey });
                await kv.put(`invoices_${studentNumber}`, JSON.stringify(invoices));
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            if (body.action === "deleteRegistration") {
                const exRegStr = await kv.get("registrations");
                let regs = exRegStr ? JSON.parse(exRegStr) : [];
                regs = regs.filter(r => r.studentNumber !== body.data.studentNumber);
                await kv.put("registrations", JSON.stringify(regs));
                await kv.delete(`proof_${body.data.studentNumber}`);
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }
            
            if (body.action === "deleteProofOnly") {
                await kv.delete(`proof_${body.data.studentNumber}`);
                const exRegStr = await kv.get("registrations");
                let regs = exRegStr ? JSON.parse(exRegStr) : [];
                const idx = regs.findIndex(r => r.studentNumber === body.data.studentNumber);
                if (idx !== -1) {
                    regs[idx].hasProof = false; regs[idx].proofFile = null; regs[idx].paymentStatus = "awaiting_payment";
                    await kv.put("registrations", JSON.stringify(regs));
                }
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            if (body.action === "yearEndMasterReset") {
                const exRegStr = await kv.get("registrations");
                const regs = exRegStr ? JSON.parse(exRegStr) : [];
                for(const r of regs) if(r.studentNumber) await kv.delete(`proof_${r.studentNumber}`);
                await kv.put("registrations", JSON.stringify([]));
                await kv.put("student_counter", "1");
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            if (body.action === "logStudentPayment") {
                const { studentNumber, paymentEntry } = body.data;
                const regsStr = await kv.get("registrations");
                let regs = regsStr ? JSON.parse(regsStr) : [];
                const idx = regs.findIndex(r => r.studentNumber === studentNumber);
                if (idx !== -1) {
                    if (!Array.isArray(regs[idx].paymentHistory)) regs[idx].paymentHistory = [];
                    regs[idx].paymentHistory.unshift({ id: `pay_${Date.now()}`, ...paymentEntry });
                    await kv.put("registrations", JSON.stringify(regs));
                    return new Response(JSON.stringify({ success: true, paymentHistory: regs[idx].paymentHistory }), { status: 200, headers });
                }
            }

            if (body.action === "deleteStudentPaymentLog") {
                const { studentNumber, paymentId } = body.data;
                const regsStr = await kv.get("registrations");
                let regs = regsStr ? JSON.parse(regsStr) : [];
                const idx = regs.findIndex(r => r.studentNumber === studentNumber);
                if (idx !== -1 && Array.isArray(regs[idx].paymentHistory)) {
                    regs[idx].paymentHistory = regs[idx].paymentHistory.filter(p => p.id !== paymentId);
                    await kv.put("registrations", JSON.stringify(regs));
                    return new Response(JSON.stringify({ success: true, paymentHistory: regs[idx].paymentHistory }), { status: 200, headers });
                }
            }

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });
        } catch (error) { return new Response(JSON.stringify({ error: "Server error." }), { status: 400, headers }); }
    }
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
}