interface ProjectEditorHeaderProps {
  projectName: string;
}

export function ProjectEditorHeader({
  projectName,
}: ProjectEditorHeaderProps) {
  return (
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">Project editor</p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {projectName}
      </h1>

      <p className="text-sm text-muted-foreground">
        Manage your project information, content, and resources.
      </p>
    </header>
  );
}