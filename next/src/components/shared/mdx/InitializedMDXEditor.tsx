"use client";
// InitializedMDXEditor.tsx
import type { ForwardedRef } from "react";
import {
  toolbarPlugin,
  KitchenSinkToolbar,
  listsPlugin,
  quotePlugin,
  headingsPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  thematicBreakPlugin,
  frontmatterPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  directivesPlugin,
  AdmonitionDirectiveDescriptor,
  diffSourcePlugin,
  markdownShortcutPlugin,
  MDXEditor,
  MDXEditorMethods,
  MDXEditorProps,
  UndoRedo,
  BoldItalicUnderlineToggles,
  InsertImage,
} from "@mdxeditor/editor";
import { useTheme } from "next-themes";

// Only import this to the next file
export default function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  const { theme } = useTheme();

  async function imageUploadHandler(image: File) {
    console.log(image);
    return "url of tha img";
  }

  return (
    <MDXEditor
    {...props}
    className={`  ${props.className} ${theme === "light" ? "light-theme light-editor" : "dark-theme dark-editor"}`}
      plugins={[
        // Example Plugin Usage
        listsPlugin(),
        quotePlugin(),
        headingsPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        // eslint-disable-next-line @typescript-eslint/require-await
        imagePlugin({ imageUploadHandler: async () => "/sample-image.png" }),
        tablePlugin(),
        thematicBreakPlugin(),
        frontmatterPlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            js: "JavaScript",
            css: "CSS",
            txt: "text",
            tsx: "TypeScript",
          },
        }),
        directivesPlugin({
          directiveDescriptors: [AdmonitionDirectiveDescriptor],
        }),
        diffSourcePlugin({ viewMode: "rich-text" }),
        markdownShortcutPlugin(),

        toolbarPlugin({
          toolbarClassName: "my-classname",
          toolbarContents: () => (
            <div className="flex gap-2 flex-wrap">
              {/* <UndoRedo />
                            <BoldItalicUnderlineToggles />
                            <InsertImage /> */}
              <KitchenSinkToolbar />
            </div>
          ),
        }),
      ]}
      ref={editorRef}
    />
  );
}
