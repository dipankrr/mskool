"use client";

import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { ModeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";

/**
 * A page, not a dropdown.
 *
 * The template this project started from hid the account behind an avatar menu.
 * That is a poor fit here: a hidden menu is one more thing to discover, and the
 * things inside it — who am I signed in as, what am I allowed to do, how do I leave —
 * are exactly what a confused user goes looking for. So Profile is a destination with
 * the same standing as Classes, reachable from the sidebar and the bottom tabs.
 *
 * Roles and permissions are shown because "why can't I see fees?" is a support
 * question this answers without a phone call. It is read-only: role assignment is a
 * server-side operation with no UI in this phase.
 */
export default function ProfilePage() {
  const { me, membership } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.profile.title} description={copy.profile.subtitle} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.profile.account}</CardTitle>
          <CardDescription>{membership.organization.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground text-sm">Name</dt>
            <dd className="text-sm">{me.user.name}</dd>

            <dt className="text-muted-foreground text-sm">{copy.auth.email}</dt>
            <dd className="text-sm break-all">{me.user.email ?? copy.common.none}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.profile.access}</CardTitle>
          <CardDescription>
            What your school has given you permission to do.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm">{copy.profile.roles}</span>
            <div className="flex flex-wrap gap-1.5">
              {membership.roleTypes.map((role) => (
                <Badge key={role} variant="secondary">
                  {role.replaceAll("_", " ")}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm">{copy.profile.scope}</span>
            <div className="flex flex-wrap gap-1.5">
              {membership.scopeTypes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scope}
                </Badge>
              ))}
              <Badge variant="outline">
                {membership.permissions.length} {copy.profile.permissionCount}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.profile.appearance}</CardTitle>
          <CardDescription>{copy.profile.appearanceHelp}</CardDescription>
        </CardHeader>
        <CardContent>
          <ModeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.nav.signOut}</CardTitle>
          <CardDescription>{copy.profile.signOutHelp}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton variant="destructive" />
        </CardContent>
      </Card>
    </>
  );
}
