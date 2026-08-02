// import { authClient } from "@/lib/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";


export default async function ProtectedLayout({
    children
}: {
    children: ReactNode;
}) {

//     const session = await authClient.getSession()
//     if (!session.data?.session)
//         redirect("/login");

const cookie = (await headers()).get("cookie") ?? "";

type SessionResponse = {
    session?: unknown;
};

const res = await fetch("http://localhost:4000/api/auth/get-session", {
    headers: {
        cookie,
    },
    // cache: "no-store",
});
const session = (await res.json()) as SessionResponse;
    console.log("session::", session)
    
    if (!session.session) {
        redirect("/login");
    }

    return children;

}


