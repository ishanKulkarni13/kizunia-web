import UserProfileEdit from "@/components/user/user-profile-edit"
import PageWrapper from  "@/components/page-wrapper"
export default function ProfilePage() {
  return (
    <PageWrapper breadcrumbs={[]} >
      <UserProfileEdit />
    </PageWrapper>
  )
}
