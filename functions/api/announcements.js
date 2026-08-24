export async function onRequest(context) {
    const { request, env } = context;
    
    // IF USER IS VIEWING WEBSITE: Send them the current live announcement
    if (request.method === "GET") {
        const text = await env.HAWWA_DB.get("live_announcement");
        return new Response(text || "Registration is open.", { status: 200 });
    }
    
    // IF ADMIN IS UPDATING WEBSITE: Check Secret Password, then save to DB
    if (request.method === "POST") {
        const adminPassword = request.headers.get("Authorization");
        
        // This checks against the Cloudflare Environment Variable!
        if (adminPassword !== env.ADMIN_PASSWORD) {
            return new Response("Unauthorized", { status: 401 });
        }
        
        const newText = await request.text();
        await env.HAWWA_DB.put("live_announcement", newText);
        return new Response("Updated", { status: 200 });
    }
}
