"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ChevronsUpDown, LogOut, PlusCircle } from "lucide-react";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useSidebar } from "../ui/sidebar";
import { toast } from "sonner";
import { Skeleton } from "../ui/skeleton";
import { APIError } from "better-auth/api";
import { getErrorMessage } from "@/utils/error";
import { DeviceSession, Session } from "@/types/auth-types";

export interface AccountSwitcherProps
  extends React.ComponentProps<typeof DropdownMenu> {
  currentSessionData?: Session;
  // sessions: DeviceSession[];
  // isLoading?: boolean;
  // setLoading: (loading: boolean) => void;
  className?: string;
}

export default function AccountSwitcher({
  currentSessionData,
  // sessions,
  className,
  // isLoading,
  // setLoading,
}: AccountSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<DeviceSession[]>();
  
  const [loading, setLoading] = useState<boolean>(false);
  const { isMobile } = useSidebar();
  const router = useRouter();

  // Handler to log out a specific session

  
  return (
    <></>
    // <DropdownMenu open={open} onOpenChange={setOpen}>
    //   <DropdownMenuTrigger asChild>
    //     {currentSessionData && !loading ? (
    //       <Button
    //         variant="outline"
    //         role="combobox"
    //         aria-expanded={open}
    //         aria-label="Select a user"
    //         className={`w-[250px] justify-between px-3 py-2 ${className}`}
    //       >
    //         <Avatar className="mr-2 h-6 w-6 rounded-lg">
    //           <AvatarImage
    //             src={currentSessionData?.user.image || undefined}
    //             alt={currentSessionData?.user.name}
    //           />
    //           <AvatarFallback>
    //             {currentSessionData?.user.name.charAt(0)}
    //           </AvatarFallback>
    //         </Avatar>
    //         <span className="truncate">{currentSessionData?.user.name}</span>
    //         <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
    //       </Button>
    //     ) : (
    //       <Skeleton className="h-10 w-[250px] rounded-lg" />
    //     )}
    //   </DropdownMenuTrigger>
    //   <DropdownMenuContent
    //     className="w-[250px] p-0"
    //     align="end"
    //     sideOffset={20}
    //     side={isMobile ? "bottom" : "right"}
    //   >
    //     {/* Current Account Group */}
    //     <DropdownMenuGroup>
    //       <DropdownMenuLabel className="px-4 pt-3 text-xs text-muted-foreground font-semibold tracking-wide">
    //         Current Account
    //       </DropdownMenuLabel>
    //       <DropdownMenuItem
    //         disabled
    //         className="flex items-center gap-2 px-4 py-2 cursor-default"
    //       >
    //         <Avatar className="h-7 w-7 rounded-lg mr-2">
    //           <AvatarImage
    //             src={currentSessionData?.user.image || undefined}
    //             alt={currentSessionData?.user.name}
    //           />
    //           <AvatarFallback>
    //             {currentSessionData?.user.name.charAt(0)}
    //           </AvatarFallback>
    //         </Avatar>
    //         <div className="flex flex-col min-w-0">
    //           <span className="truncate font-medium">
    //             {currentSessionData?.user.name}
    //           </span>
    //           <span className="truncate text-xs text-muted-foreground">
    //             {currentSessionData?.user.email}
    //           </span>
    //         </div>
    //       </DropdownMenuItem>
    //     </DropdownMenuGroup>

    //     <DropdownMenuSeparator />

    //     {/* Switch Account Group */}
    //     <DropdownMenuGroup>
    //       <DropdownMenuLabel className=" text-xs text-muted-foreground font-semibold tracking-wide">
    //         {(sessions && sessions?.length <= 1 )? (
    //           <span className="text-xs text-muted-foreground">
    //             No other accounts
    //           </span>
    //         ) : (
    //           "Switch Account"
    //         )}
    //       </DropdownMenuLabel>
    //       {!!sessions && sessions
    //         .filter((s) => s.user.id !== currentSessionData?.user.id)
    //         .map((u, i) => (
    //           <DropdownMenuItem
    //             className=" mx-1 my-2"
    //             key={i}
    //             onSelect={async () => {
    //               await authClient.multiSession.setActive(
    //                 {
    //                   sessionToken: u.session.token,
    //                 },
    //                 {
    //                   onRequest: () => {
    //                     setLoading?.(true);
    //                   },
    //                   onSuccess: () => {
    //                     setLoading?.(false);
    //                     refetchActiveOrg();
    //                     router.refresh();
    //                     toast.success("Switched account", {
    //                       id: "switch-account",
    //                       action: {
    //                         label: "Refresh",
    //                         onClick: () => {
    //                           window.location.reload();
    //                         },
    //                       },
    //                     });
    //                   },
    //                   onError: (error) => {
    //                     setLoading?.(false);
    //                     if (error instanceof APIError) {
    //                       toast.error(error.message, { id: "switch-account" });
    //                     } else {
    //                       toast.error("Failed to switch account", {
    //                         id: "switch-account",
    //                       });
    //                     }
    //                   },
    //                 }
    //               );
    //               setOpen(false);
    //             }}
    //           >
    //             <ContextMenu>
    //               <ContextMenuTrigger asChild>
    //                 <div className="flex items-center gap-2 text-sm">
    //                   <Avatar className="h-6 w-6 rounded-lg mr-2">
    //                     <AvatarImage
    //                       src={u.user.image || undefined}
    //                       alt={u.user.name}
    //                     />
    //                     <AvatarFallback>{u.user.name.charAt(0)}</AvatarFallback>
    //                   </Avatar>
    //                   <div className="flex flex-col min-w-0">
    //                     <span className="truncate font-medium">
    //                       {u.user.name}
    //                     </span>
    //                     <span className="truncate text-xs text-muted-foreground">
    //                       {u.user.email}
    //                     </span>
    //                   </div>
    //                 </div>
    //               </ContextMenuTrigger>
    //               <ContextMenuContent>
    //                 <ContextMenuItem
    //                   onClick={async (e) => {
    //                     e.preventDefault();
    //                     await handleLogoutSession(u.session.token);
    //                   }}
    //                 >
    //                   <LogOut /> Logout
    //                 </ContextMenuItem>
    //               </ContextMenuContent>
    //             </ContextMenu>
    //           </DropdownMenuItem>
    //         ))}
    //     </DropdownMenuGroup>

    //     <DropdownMenuSeparator />

    //     {/* Add Account Group */}
    //     <DropdownMenuGroup>
    //       <DropdownMenuLabel className=" text-xs text-muted-foreground font-semibold tracking-wide">
    //         Add Account
    //       </DropdownMenuLabel>
    //       <DropdownMenuItem
    //         onSelect={() => {
    //           router.push("/sign-in");
    //           setOpen(false);
    //         }}
    //         className="flex items-center gap-2 px-4 mx-1 my-2 py-2 text-sm cursor-pointer"
    //       >
    //         <PlusCircle className="h-5 w-5 mr-2" />
    //         <span>Add Account</span>
    //       </DropdownMenuItem>
    //     </DropdownMenuGroup>
    //   </DropdownMenuContent>
    // </DropdownMenu>
  );
}
