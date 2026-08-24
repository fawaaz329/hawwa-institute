export async function onRequestGet(context) {
    const { request, env } = context;
    
    // Check Secret Password
    const adminPassword = request.headers.get("Authorization");
    if (adminPassword !== env.ADMIN_PASSWORD) {
        return new Response("Unauthorized", { status: 401 });
    }
    
    // Fetch all records starting with "reg_" from the Database
    const list = await env.HAWWA_DB.list({ prefix: "reg_" });
    let registrations = [];
    
    for (const key of list.keys) {
        const val = await env.HAWWA_DB.get(key.name);
        registrations.push(JSON.parse(val));
    }
    
    return new Response(JSON.stringify(registrations), { 
        headers: { "Content-Type": "application/json" } 
    });
}
