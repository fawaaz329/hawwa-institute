export async function onRequestPost(context) {
    const input = await context.request.json();
    const id = crypto.randomUUID();
    // Saves to database under "reg_ID"
    await context.env.HAWWA_DB.put(`reg_${id}`, JSON.stringify(input));
    return new Response("Saved", { status: 200 });
}
