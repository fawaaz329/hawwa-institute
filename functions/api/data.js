export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };

    // Your Cloudflare Secret
    const adminSecret = env.ADMIN_PASSWORD;

    // Your Cloudflare KV binding
    if (!env.HAWWA_DB) {
        return new Response(
            JSON.stringify({ error: "HAWWA_DB binding is not configured." }),
            { status: 500, headers }
        );
    }

    // ==========================================
    // GET — LOAD PUBLIC DATA / ADMIN DATA
    // ==========================================
    if (request.method === "GET") {
        try {
            const publicStr = await env.HAWWA_DB.get("public_state");

            const publicData = publicStr
                ? JSON.parse(publicStr)
                : null;

            // Check admin password
            const suppliedPassword =
                request.headers.get("Authorization") || "";

            const isAdmin =
                adminSecret &&
                suppliedPassword === adminSecret;

            // Admin gets registrations as well
            if (isAdmin) {
                const registrationStr =
                    await env.HAWWA_DB.get("registrations");

                const registrations = registrationStr
                    ? JSON.parse(registrationStr)
                    : [];

                return new Response(
                    JSON.stringify({
                        public: publicData,
                        registrations: registrations
                    }),
                    {
                        status: 200,
                        headers
                    }
                );
            }

            // Normal visitor only gets public information
            return new Response(
                JSON.stringify({
                    public: publicData
                }),
                {
                    status: 200,
                    headers
                }
            );

        } catch (error) {
            return new Response(
                JSON.stringify({
                    error: "Unable to load Hawwā data."
                }),
                {
                    status: 500,
                    headers
                }
            );
        }
    }

    // ==========================================
    // POST — REGISTRATION / ADMIN SAVE
    // ==========================================
    if (request.method === "POST") {
        try {
            const body = await request.json();

            // ==========================================
            // A. STUDENT REGISTRATION
            // ==========================================
            if (body.action === "register") {

                if (!body.data || typeof body.data !== "object") {
                    return new Response(
                        JSON.stringify({
                            error: "Invalid registration."
                        }),
                        {
                            status: 400,
                            headers
                        }
                    );
                }

                const currentRegistrations =
                    await env.HAWWA_DB.get("registrations");

                const registrations =
                    currentRegistrations
                        ? JSON.parse(currentRegistrations)
                        : [];

                const registration = {
                    ...body.data,

                    date:
                        body.data.date ||
                        new Date().toLocaleDateString("en-GB"),

                    status:
                        body.data.status ||
                        "New"
                };

                registrations.push(registration);

                await env.HAWWA_DB.put(
                    "registrations",
                    JSON.stringify(registrations)
                );

                return new Response(
                    JSON.stringify({
                        success: true
                    }),
                    {
                        status: 200,
                        headers
                    }
                );
            }

            // ==========================================
            // B. ADMIN SAVE
            // ==========================================
            if (body.action === "adminSave") {

                const suppliedPassword =
                    request.headers.get("Authorization") || "";

                // Check Cloudflare ADMIN_PASSWORD secret
                if (
                    !adminSecret ||
                    suppliedPassword !== adminSecret
                ) {
                    return new Response(
                        JSON.stringify({
                            error: "Unauthorized."
                        }),
                        {
                            status: 401,
                            headers
                        }
                    );
                }

                if (
                    !body.data ||
                    typeof body.data !== "object"
                ) {
                    return new Response(
                        JSON.stringify({
                            error: "Invalid site data."
                        }),
                        {
                            status: 400,
                            headers
                        }
                    );
                }

                // Keep registrations separate from public website data
                const {
                    registrations,
                    ...publicData
                } = body.data;

                // Save public website information
                await env.HAWWA_DB.put(
                    "public_state",
                    JSON.stringify(publicData)
                );

                // Save registrations
                await env.HAWWA_DB.put(
                    "registrations",
                    JSON.stringify(
                        Array.isArray(registrations)
                            ? registrations
                            : []
                    )
                );

                return new Response(
                    JSON.stringify({
                        success: true
                    }),
                    {
                        status: 200,
                        headers
                    }
                );
            }

            // Unknown POST action
            return new Response(
                JSON.stringify({
                    error: "Unknown action."
                }),
                {
                    status: 400,
                    headers
                }
            );

        } catch (error) {
            return new Response(
                JSON.stringify({
                    error: "Invalid request."
                }),
                {
                    status: 400,
                    headers
                }
            );
        }
    }

    // ==========================================
    // OTHER HTTP METHODS
    // ==========================================
    return new Response(
        JSON.stringify({
            error: "Method not allowed."
        }),
        {
            status: 405,
            headers: {
                ...headers,
                "Allow": "GET, POST"
            }
        }
    );
            }
