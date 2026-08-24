export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };

    // Secret stored in Cloudflare Dashboard
    const adminSecret = env.ADMIN_PASSWORD;

    // Verify database connection
    if (!env.HAWWA_DB) {
        return new Response(
            JSON.stringify({ error: "HAWWA_DB binding is not configured." }),
            { status: 500, headers }
        );
    }

    // ==========================================
    // GET — LOAD PUBLIC DATA / VERIFY ADMIN
    // ==========================================
    if (request.method === "GET") {
        try {
            const suppliedPassword = request.headers.get("Authorization");

            // 1. IF USER IS TRYING TO LOG IN AS ADMIN:
            if (suppliedPassword !== null && suppliedPassword !== "") {
                // STRICT CHECK: If password doesn't match Cloudflare secret, REJECT!
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(
                        JSON.stringify({ error: "Invalid administrator password." }),
                        { status: 401, headers }
                    );
                }

                // PASSWORD IS CORRECT: Send public data + private registrations
                const [publicStr, registrationStr] = await Promise.all([
                    env.HAWWA_DB.get("public_state"),
                    env.HAWWA_DB.get("registrations")
                ]);

                return new Response(
                    JSON.stringify({
                        authenticated: true,
                        public: publicStr ? JSON.parse(publicStr) : null,
                        registrations: registrationStr ? JSON.parse(registrationStr) : []
                    }),
                    { status: 200, headers }
                );
            }

            // 2. NORMAL PUBLIC VISITOR (NO PASSWORD SENT)
            const publicStr = await env.HAWWA_DB.get("public_state");
            return new Response(
                JSON.stringify({
                    authenticated: false,
                    public: publicStr ? JSON.parse(publicStr) : null
                }),
                { status: 200, headers }
            );

        } catch (error) {
            return new Response(
                JSON.stringify({ error: "Unable to load Hawwā data." }),
                { status: 500, headers }
            );
        }
    }

    // ==========================================
    // POST — STUDENT REGISTRATION / ADMIN SAVE
    // ==========================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // A. STUDENT SUBMITTING REGISTRATION
            if (body.action === "register") {
                if (!body.data || typeof body.data !== "object") {
                    return new Response(JSON.stringify({ error: "Invalid data." }), { status: 400, headers });
                }

                const currentRegistrations = await env.HAWWA_DB.get("registrations");
                const registrations = currentRegistrations ? JSON.parse(currentRegistrations) : [];

                registrations.push({
                    ...body.data,
                    date: body.data.date || new Date().toLocaleDateString("en-GB"),
                    status: body.data.status || "New"
                });

                await env.HAWWA_DB.put("registrations", JSON.stringify(registrations));
                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            // B. ADMIN SAVING CHANGES
            if (body.action === "adminSave") {
                const suppliedPassword = request.headers.get("Authorization") || "";

                // STRICT AUTH CHECK BEFORE SAVING
                if (!adminSecret || suppliedPassword.trim() !== adminSecret.trim()) {
                    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers });
                }

                const { registrations, ...publicData } = body.data;

                await env.HAWWA_DB.put("public_state", JSON.stringify(publicData));
                await env.HAWWA_DB.put("registrations", JSON.stringify(Array.isArray(registrations) ? registrations : []));

                return new Response(JSON.stringify({ success: true }), { status: 200, headers });
            }

            return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers });

        } catch (error) {
            return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers });
        }
    }

    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
}
