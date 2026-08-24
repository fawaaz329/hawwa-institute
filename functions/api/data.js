export async function onRequest(context) {
    const { request, env } = context;

    // 1. IF PAGE IS LOADING (GET DATA)
    if (request.method === "GET") {
        // Get public website info (Announcements, Timetable, Resources)
        const publicStr = await env.HAWWA_DB.get("public_state");
        const publicData = publicStr ? JSON.parse(publicStr) : null;
        
        // If Admin is logging in, give them the Registrations too
        const pass = request.headers.get("Authorization");
        if (pass === env.ADMIN_PASSWORD) {
            const regStr = await env.HAWWA_DB.get("registrations");
            return new Response(JSON.stringify({ 
                public: publicData, 
                registrations: regStr ? JSON.parse(regStr) : [] 
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        
        // If normal user, just send public data
        return new Response(JSON.stringify({ public: publicData }), { status: 200 });
    }

    // 2. IF SUBMITTING A FORM OR SAVING ADMIN EDITS (POST DATA)
    if (request.method === "POST") {
        const body = await request.json();

        // A. Student registering
        if (body.action === "register") {
            const currentRegs = await env.HAWWA_DB.get("registrations");
            let list = currentRegs ? JSON.parse(currentRegs) : [];
            list.push(body.data);
            await env.HAWWA_DB.put("registrations", JSON.stringify(list));
            return new Response("Registered", { status: 200 });
        }

        // B. Admin saving changes to the website
        if (body.action === "adminSave") {
            const pass = request.headers.get("Authorization");
            if (pass !== env.ADMIN_PASSWORD) return new Response("Unauthorized", { status: 401 });

            // Extract the public data and registrations from the payload
            const { registrations, ...publicData } = body.data;
            
            // Save them to the database
            await env.HAWWA_DB.put("public_state", JSON.stringify(publicData));
            await env.HAWWA_DB.put("registrations", JSON.stringify(registrations));
            
            return new Response("Saved Globally", { status: 200 });
        }
    }
                                   }
