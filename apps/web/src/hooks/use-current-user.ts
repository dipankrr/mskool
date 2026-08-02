"use client";


import { authClient } from "@/lib/auth-client";


export function useCurrentUser() {

    const {
        data,
        isPending
    } = authClient.useSession();


    return {
        user: data?.user,
        session: data,
        isLoading: isPending
    };

}