export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 1. IF USER WANTS TO DOWNLOAD OR VIEW RESOURCES
    if (request.method === "GET") {
        const id = url.searchParams.get("id");
        if (id) {
            // Give the specific file data to the student
            const fileData = await env.HAWWA_DB.get(`res_${id}`);
            return new Response(fileData, { status: 200 });
        } else {
            // Give the list of all files to display on the website
            const listStr = await env.HAWWA_DB.get("resources_list");
            return new Response(listStr || "[]", { status: 200, headers: { "Content-Type": "application/json" } });
        }
    }

    // 2. IF ADMIN IS UPLOADING A NEW DOCUMENT
    if (request.method === "POST") {
        const adminPassword = request.headers.get("Authorization");
        if (adminPassword !== env.ADMIN_PASSWORD) return new Response("Unauthorized", { status: 401 });

        const input = await request.json(); // Gets file name and data
        const id = crypto.randomUUID(); // Creates unique ID

        // Update the list of files
        let listStr = await env.HAWWA_DB.get("resources_list");
        let list = listStr ? JSON.parse(listStr) : [];
        list.push({ id: id, name: input.name, date: input.date });
        
        // Save the list and the actual file
        await env.HAWWA_DB.put("resources_list", JSON.stringify(list));
        await env.HAWWA_DB.put(`res_${id}`, input.data); // input.data is the base64 file

        return new Response("Uploaded Successfully", { status: 200 });
    }
}
