"use client";

import { authClient } from "@/lib/auth-client";


export function useAuth() {

    const session =
        authClient.useSession();


    async function register(
        name: string,
        email: string,
        password: string
    ) {

        return authClient.signUp.email({
            name,
            email,
            password
        });

    }


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
        register,
        login,
        logout
    };

}