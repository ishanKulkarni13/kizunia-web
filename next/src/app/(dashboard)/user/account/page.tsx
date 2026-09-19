import ActiveSessions from "@/components/auth/active-sessions";
import Manage2fa from "@/components/auth/manage-2fa";
import ManageAccountPassword from "@/components/auth/manage-account-password";
import PageWrapper from "@/components/page-wrapper";


export default function AccountPage() {
  return (
    <PageWrapper breadcrumbs={[]} >

    <div className="m-2 flex flex-col justify-stretch items-stretch   gap-2" >
      <ManageAccountPassword/>
      <Manage2fa/>
      <ActiveSessions/>
    </div>
    </PageWrapper>
  )
}
