"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"

import { LogIn, LogOut, User } from "lucide-react"

import { useRouter } from "next/navigation"
import { useAuth } from "@/features/auth/hooks/use-auth"
import { useCurrentUser } from "@/hooks/use-current-user"

type UserType = {
  name: string
  email: string
  image?: string
}


export function NavbarProfile({
  userU,
  onLogin,
  onLogout,
}: {
  userU?: UserType | null
  onLogin?: () => void
  onLogout?: () => void
}) {

  const router = useRouter()
  const {logout} = useAuth()

    const { user } = useCurrentUser()
    const navbarUser = user ? { ...user, image: user.image ?? undefined } : undefined

  return (
    <DropdownMenu>

      <DropdownMenuTrigger>
        <Avatar className="h-9 w-9 cursor-pointer">
          <AvatarImage
            src={user?.image ?? undefined}
            alt={user?.name ?? "Profile"}
          />

          <AvatarFallback>
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>


      <DropdownMenuContent
        align="end"
        className="w-64"
      >

        <DropdownMenuGroup>

          
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {user?.name ?? "Guest"}
              </span>

              {user?.email && (
                <span className="text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </div>
          

        </DropdownMenuGroup>


        <DropdownMenuSeparator />


        {user ? (
          <>
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => {
            logout();
            router.push("/login");
          }}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </>
        ) : (

          <DropdownMenuItem onClick={()=>{router.push("/login")}}>
            <LogIn className="mr-2 h-4 w-4" />
            Login
          </DropdownMenuItem>

        )}

      </DropdownMenuContent>

    </DropdownMenu>
  )
}