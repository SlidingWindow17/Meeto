import { getAuth, clerkClient } from "@clerk/express"
import {sql} from "../config/db.js"

export const protect = async (req, res, next) =>{
    const auth = getAuth(req);
    const userId = auth?.userId || req.auth?.userId;

    if(!userId){
        return res.status(401).json({ error: "Not authorized, authentication required" });
    }

    req.user = {id: userId};

    const userActivePlan = auth.has({plan: "premium"}) ? "premium" : "free";

    const users = await sql`SELECT name, plan FROM users WHERE id = ${userId}`

    if(users.length === 0){
        // User exists in Clerk but not in our DB (webhook missed / local dev).
        // Fetch their details from Clerk and upsert so every request is unblocked.
        try {
            const clerkUser = await clerkClient.users.getUser(userId);
            const name = `${clerkUser.firstName || "User"} ${clerkUser.lastName || ""}`.trim();
            const email = clerkUser.emailAddresses?.[0]?.emailAddress || "";
            const image = clerkUser.imageUrl || "";

            await sql`
                INSERT INTO users (id, name, email, image, plan)
                VALUES (${userId}, ${name}, ${email}, ${image}, ${userActivePlan})
                ON CONFLICT (id) DO UPDATE SET
                    name  = EXCLUDED.name,
                    email = EXCLUDED.email,
                    image = EXCLUDED.image,
                    plan  = EXCLUDED.plan,
                    updated_at = NOW()
            `;
        } catch (err) {
            console.error("Failed to auto-upsert user from Clerk:", err.message);
            // Insert a minimal row so the FK constraint is satisfied
            await sql`
                INSERT INTO users (id, name, email, image, plan)
                VALUES (${userId}, 'User', '', '', ${userActivePlan})
                ON CONFLICT (id) DO NOTHING
            `;
        }
    } else {
        const userPlan = users[0]?.plan;
        if(userActivePlan !== userPlan){
            await sql`UPDATE users SET plan = ${userActivePlan} WHERE id = ${userId}`
        }
    }

    next()
}