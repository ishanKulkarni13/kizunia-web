"use client"
import PageWrapper from "@/components/page-wrapper";
import { ForwardRefEditor } from "@/components/shared/mdx/ForwardRefEditor";
import { Suspense, useState } from "react";

export default function SignInPage() {
    const initialMarkdown = "# hello this is a heading \n \n this is a **bold** text and this is an *italic* text";
    const [markdown, setMarkdown] = useState(initialMarkdown)
    return (
    <PageWrapper breadcrumbs={[]} >
        <Suspense fallback={null}>
            <ForwardRefEditor onChange={(v) => { setMarkdown(v) }} markdown={markdown} />
        </Suspense>


        {/* button to print the current md */}
        <button className="px-4 py-2 mt-2 mx-auto block max-w-sm  bg-accent rounded-2xl text-accent-foreground" onClick={() => {
            console.log(markdown)
        }}>Print Markdown</button>
        </PageWrapper>
    )
}