import PageWrapper from '@/components/page-wrapper'
import React from 'react'

export default function Page() {
  return (
    <PageWrapper breadcrumbs={[{label:"Dashboard", href:"/dashboard"}, {label:"user Profile", href:"/dashboard/user/profile"}]} >

      noting to see here
    </PageWrapper>
  )
}
