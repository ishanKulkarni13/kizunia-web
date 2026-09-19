"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { useCompetitionSuggestionStore } from "../../store/competition-suggestion-store";
import type { CompetitionSuggestionDTO } from "../../types/suggestion";

interface SuggestionFieldsEditorProps {
  suggestion: CompetitionSuggestionDTO;
}

/**
 * Title/description editing for a DRAFT suggestion. Saves on blur rather
 * than via a visible "Save" button — a button click always blurs the field
 * it left first, so this also covers "save before navigating away" for the
 * Back/Submit actions that sit below it.
 */
export function SuggestionFieldsEditor({
  suggestion,
}: SuggestionFieldsEditorProps) {
  const update = useCompetitionSuggestionStore((state) => state.update);

  const [title, setTitle] = useState(suggestion.suggestionTitle);
  const [content, setContent] = useState(
    suggestion.suggestionContent?.content ?? "",
  );

  const [savedTitle, setSavedTitle] = useState(suggestion.suggestionTitle);
  const [savedContent, setSavedContent] = useState(
    suggestion.suggestionContent?.content ?? "",
  );

  async function saveTitle() {
    const trimmed = title.trim();

    if (trimmed.length < 3 || trimmed === savedTitle) return;

    await update(suggestion.id, { suggestionTitle: trimmed });

    setSavedTitle(trimmed);
  }

  async function saveContent() {
    if (content === savedContent) return;

    await update(suggestion.id, { suggestionContent: content });

    setSavedContent(content);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="suggestion-title">
          Competition title
        </Label>

        <Input
          id="suggestion-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          minLength={3}
          maxLength={150}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="suggestion-content">
          Description
        </Label>

        <Textarea
          id="suggestion-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onBlur={saveContent}
          placeholder="Tell us anything useful about the competition..."
          rows={10}
          className="resize-y"
        />

        <p className="text-sm text-muted-foreground">
          Optional. You can include dates, organizer
          details, links, prizes, or anything else you
          know. Markdown/MDX content is supported.
        </p>
      </div>
    </div>
  );
}
