"use client";

import { authClient } from "@/lib/auth-client";


export function useAuth() {

    const session =
        authClient.useSession();


    // No register(): self-registration is closed (ADR-021). Accounts are
    // provisioned by the organization, and the sign-up route is blocked at the
    // API edge, so a caller here would only get a 404.

    async function login(

        email: string,
        password: string
    ) {

        return authClient.signIn.email({
            email,
            password
        });

    }


    async function logout() {

        return authClient.signOut();

    }


    return {
        ...session,
        login,
        logout
    };


}