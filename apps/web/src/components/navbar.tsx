import { NavbarProfile } from "./navbar-profile"
import { ModeToggle } from "./theme-toggle"

export default function Navbar() {
  return (
    
    <header className="border-b">

      <div className="
        mx-auto
        flex
        h-16
        max-w-7xl
        items-center
        justify-between
        px-6
      ">

        {/* Logo */}
        <div className="text-xl font-bold">
          mskool
        </div>



        {/* Right side */}
        <div className="flex items-center gap-4">

          <ModeToggle />

          <NavbarProfile/>

        </div>

      </div>

    </header>
  )
}