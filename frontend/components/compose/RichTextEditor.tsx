"use client";

import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";

interface RichTextEditorProps {
  onChange: (html: string) => void;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${
        active ? "bg-primary-100 text-primary-700" : "text-chrome-500 hover:bg-chrome-100"
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: "Write your message…" }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap min-h-[12rem] max-w-none focus:outline-none text-sm",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-chrome-300 bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary-500">
      <div className="flex items-center gap-0.5 border-b border-chrome-200 bg-chrome-50 px-2 py-1.5">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-chrome-200" />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered list"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
    </div>
  );
}
