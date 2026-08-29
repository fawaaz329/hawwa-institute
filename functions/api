// Utility: Hash password securely
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "hawwa_secure_salt_2026");
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Base64 to Uint8Array for R2 storage
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

    // Connects to your Cloudflare KV and R2 bindings
    const kv = env.HAWWA_KV || env.hawwa_kv || env.HAWWA_DB || env.hawwa_db;
    const r2 = env.HAWWA_FILES; 
    const adminSecret = env.ADMIN_PASSWORD;

    if (!kv) return new Response(JSON.stringify({ error: "KV database is not connected." }), { status: 500, headers });

    const url = new URL(request.url);

    // =========================================================================
    // 1. GET REQUESTS (Public Data, Admin Auth, Student Portal, File Downloads)
    // =========================================================================
    if (request.method === "GET") {
        try {
            const suppliedPassword = request.headers.get("Authorization");
            const fileKey = url.searchParams.get("fileKey");
            const proofId = url.searchParams.get("proofId");
            const studentToken = request.headers.get("X-Student-Token");

            // A. DOWNLOAD R2 INVOICE FILE
            if (fileKey) {
                let isAuthorized = false;
                if (suppliedPassword && suppliedPassword.trim() === adminSecret) {
                    isAuthorized = true; // Admin access
                } else if (studentToken) {
                    const sessionData = await kv.get(`session_${studentToken}`);
                    if (sessionData) {
                        const { studentNumber } = JSON.parse(sessionData);
                        if (fileKey.includes(studentNumber)) isAuthorized = true; // Student owns this file
                    }
                }
                if (!isAuthorized) return new Response("Unauthorized", { status: 401 });

                if (r2) {
                    const object = await r2.get(fileKey);
                    if (object) {
                        const fileHeaders = new Headers();
                        object.writeHttpMetadata(fileHeaders);
                        fileHeaders.set("etag", object.httpEtag);
                        return new Response(object.body, { headers: fileHeaders });
                    }
                }
                return new Response("File not found in R2", { status: 404 });
            }

            // B. FETCH PAYMENT PROOF (KV)
            if (proofId) {
                if (!adminSecret || suppliedPassword?.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });
                const proofData = await kv.get(`proof_${proofId}`);
                if (!proofData) return new Response(JSON.stringify({ error: "Proof not found." }), { status: 404, headers });
                return new Response(JSON.stringify({ success: true, proof: JSON.parse(proofData) }), { status: 200, headers });
            }

            // C. STUDENT PORTAL DATA FETCH
            if (studentToken) {
                const sessionData = await kv.get(`session_${studentToken}`);
                if (!sessionData) return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
                
                const { studentNumber } = JSON.parse(sessionData);
                const existingRegsStr = await kv.get("registrations");
                const registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const student = registrations.find(r => r.studentNumber === studentNumber);
                
                const invoicesStr = await kv.get(`invoices_${studentNumber}`);
                const invoices = invoicesStr ? JSON.parse(invoicesStr) : [];

                return new Response(JSON.stringify({ authenticated: true, student, invoices }), { status: 200, headers });
            }

            // D. ADMIN AUTHENTICATION
            if (suppliedPassword !== null && suppliedPassword !== "") {
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Invalid password." }), { status: 401, headers });
                const [publicStr, regStr] = await Promise.all([kv.get("public_state"), kv.get("registrations")]);
                return new Response(JSON.stringify({ authenticated: true, public: publicStr ? JSON.parse(publicStr) : null, registrations: regStr ? JSON.parse(regStr) : [] }), { status: 200, headers });
            }

            // E. PUBLIC VISITOR
            const publicStr = await kv.get("public_state");
            return new Response(JSON.stringify({ authenticated: false, public: publicStr ? JSON.parse(publicStr) : null }), { status: 200, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Server error." }), { status: 500, headers });
        }
    }

    // =========================================================================
    // 2. POST REQUESTS
    // =========================================================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // -----------------------------------------------------------------
            // STUDENT REGISTRATION (Recycles IDs)
            // -----------------------------------------------------------------
            if (body.action === "register") {
                const regData = body.data;
                if (!regData || !regData.fname || !regData.email || !regData.courses || regData.courses.length === 0) return new Response(JSON.stringify({ error: "Missing details." }), { status: 400, headers });

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
                        studentNumber, fileName: regData.proofFile.name || "receipt.pdf", fileType: regData.proofFile.type, data: regData.proofFile.data, uploadedAt: new Date().toISOString()
                    };
                    await kv.put(`proof_${studentNumber}`, JSON.stringify(proofRecord));
                    hasProof = true;
                }

                const newRecord = {
                    studentNumber, fname: regData.fname.trim(), sname: regData.sname.trim(), phone: regData.phone.trim(),
                    whatsapp: (regData.whatsapp || regData.phone).trim(), email: regData.email.trim(), address: (regData.address || "").trim(),
                    courses: regData.courses, totalFee: regData.totalFee || "R 0", paymentMethod: regData.paymentMethod || "EFT",
                    paymentStatus: regData.paymentMethod === "EFT" ? (hasProof ? "payment_proof_received" : "awaiting_payment") : "awaiting_cash_payment",
                    status: regData.paymentMethod === "EFT" ? (hasProof ? "PAYMENT PROOF RECEIVED" : "AWAITING PAYMENT") : "CASH PAYMENT — AWAITING PAYMENT",
                    hasProof, portalAccess: false, paymentHistory: [],
                    date: new Date().toLocaleDateString("en-GB"), timestamp: new Date().toISOString()
                };

                const existingRegsStr = await kv.get("registrations");
                const registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                registrations.unshift(newRecord);
                await kv.put("registrations", JSON.stringify(registrations));

                return new Response(JSON.stringify({ success: true, studentNumber, studentName: `${newRecord.fname} ${newRecord.sname}`, courses: newRecord.courses, totalFee: newRecord.totalFee }), { status: 200, headers });
            }

            // -----------------------------------------------------------------
            // STUDENT PORTAL LOGIN & LOGOUT
            // -----------------------------------------------------------------
            if (body.action === "studentLogin") {
                const { studentNumber, password } = body.data;
                const existingRegsStr = await kv.get("registrations");
                const registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const student = registrations.find(r => r.studentNumber === studentNumber.trim().toUpperCase());

                if (!student || !student.portalAccess || !student.passwordHash) return new Response(JSON.stringify({ error: "Account not found or access disabled." }), { status: 401, headers });
                
                const attemptHash = await hashPassword(password);
                if (attemptHash !== student.passwordHash) return new Response(JSON.stringify({ error: "Incorrect password." }), { status: 401, headers });

                const token = crypto.randomUUID();
                await kv.put(`session_${token}`, JSON.stringify({ studentNumber: student.studentNumber }), { expirationTtl: 86400 });
                return new Response(JSON.stringify({ success: true, token }), { status: 200, headers });
            }

            if (body.action === "studentLogout") {
                const token = request.headers.get("X-Student-Token");
                if (token) await kv.delete(`session_${token}`);
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            // -----------------------------------------------------------------
            // ADMIN: ENABLE PORTAL & UPLOAD INVOICES
            // -----------------------------------------------------------------
            if (body.action === "adminEnablePortal" || body.action === "adminDisablePortal" || body.action === "adminUploadInvoice") {
                const suppliedPassword = request.headers.get("Authorization") || "";
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });

                if (body.action === "adminEnablePortal") {
                    const existingRegsStr = await kv.get("registrations");
                    let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                    const idx = registrations.findIndex(r => r.studentNumber === body.data.studentNumber);
                    if (idx !== -1) {
                        const tempPassword = Math.random().toString(36).slice(-6).toUpperCase();
                        registrations[idx].portalAccess = true;
                        registrations[idx].passwordHash = await hashPassword(tempPassword);
                        await kv.put("registrations", JSON.stringify(registrations));
                        return new Response(JSON.stringify({ success: true, tempPassword }), { status: 200, headers });
                    }
                }

                if (body.action === "adminDisablePortal") {
                    const existingRegsStr = await kv.get("registrations");
                    let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                    const idx = registrations.findIndex(r => r.studentNumber === body.data.studentNumber);
                    if (idx !== -1) {
                        registrations[idx].portalAccess = false;
                        await kv.put("registrations", JSON.stringify(registrations));
                        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
                    }
                }

                if (body.action === "adminUploadInvoice") {
                    const { studentNumber, type, amount, date, fileData, fileType, fileName } = body.data;
                    const invoiceId = `INV-${Date.now()}`;
                    let fileKey = null;

                    if (fileData && r2) {
                        fileKey = `invoices/${studentNumber}/${invoiceId}_${fileName}`;
                        const buffer = base64ToUint8Array(fileData);
                        await r2.put(fileKey, buffer, { httpMetadata: { contentType: fileType } });
                    }
                    
                    const invoiceRecord = { invoiceId, studentNumber, type, amount, date, fileKey, status: "Visible" };
                    const invoicesStr = await kv.get(`invoices_${studentNumber}`);
                    const invoices = invoicesStr ? JSON.parse(invoicesStr) : [];
                    invoices.unshift(invoiceRecord);
                    await kv.put(`invoices_${studentNumber}`, JSON.stringify(invoices));
                    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
                }
            }

            // -----------------------------------------------------------------
            // ADMIN ACTIONS (Saves, Logs, Resets, Deletes)
            // -----------------------------------------------------------------
            const suppliedPassword = request.headers.get("Authorization") || "";
            if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });

            if (body.action === "adminSave") {
                const { registrations, ...publicData } = body.data;
                await kv.put("public_state", JSON.stringify(publicData));
                if (Array.isArray(registrations)) await kv.put("registrations", JSON.stringify(registrations));
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            if (body.action === "updateRegistrationStatus") {
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const idx = registrations.findIndex(r => r.studentNumber === body.data.studentNumber);
                if (idx !== -1) {
                    if (body.data.status) registrations[idx].status = body.data.status;
                    if (body.data.paymentStatus) registrations[idx].paymentStatus = body.data.paymentStatus;
                    await kv.put("registrations", JSON.stringify(registrations));
                    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
                }
            }

            if (body.action === "logStudentPayment") {
                const { studentNumber, paymentEntry } = body.data;
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const idx = registrations.findIndex(r => r.studentNumber === studentNumber);
                if (idx !== -1) {
                    if (!Array.isArray(registrations[idx].paymentHistory)) registrations[idx].paymentHistory = [];
                    registrations[idx].paymentHistory.unshift({
                        id: `pay_${Date.now()}`, date: paymentEntry.date || new Date().toLocaleDateString("en-GB"),
                        month: paymentEntry.month, amount: paymentEntry.amount, method: paymentEntry.method, note: paymentEntry.note
                    });
                    await kv.put("registrations", JSON.stringify(registrations));
                    return new Response(JSON.stringify({ success: true, paymentHistory: registrations[idx].paymentHistory }), { status: 200, headers });
                }
            }

            if (body.action === "deleteStudentPaymentLog") {
                const { studentNumber, paymentId } = body.data;
                const existingRegsStr = await kv.get("registrations");
                let registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                const idx = registrations.findIndex(r => r.studentNumber === studentNumber);
                if (idx !== -1 && Array.isArray(registrations[idx].paymentHistory)) {
                    registrations[idx].paymentHistory = registrations[idx].paymentHistory.filter(p => p.id !== paymentId);
                    await kv.put("registrations", JSON.stringify(registrations));
                    return new Response(JSON.stringify({ success: true, paymentHistory: registrations[idx].paymentHistory }), { status: 200, headers });
                }
            }

            if (body.action === "deleteRegistration") {
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

            if (body.action === "deleteProofOnly") {
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

            if (body.action === "yearEndMasterReset") {
                const existingRegsStr = await kv.get("registrations");
                const registrations = existingRegsStr ? JSON.parse(existingRegsStr) : [];
                for (const r of registrations) if (r.studentNumber) await kv.delete(`proof_${r.studentNumber}`);
                await kv.put("registrations", JSON.stringify([]));
                await kv.put("recycled_numbers", JSON.stringify([]));
                await kv.put("student_counter", "1");
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });
        } catch (error) {
            return new Response(JSON.stringify({ error: "Server error." }), { status: 400, headers });
        }
    }
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
}
