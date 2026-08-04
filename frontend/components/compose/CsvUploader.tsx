"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/apiClient";

interface CsvUploaderProps {
  onParsed: (emails: string[]) => void;
}

export function CsvUploader({ onParsed }: CsvUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.parseLeads(file);
      onParsed(result.validEmails);
      toast.success(
        `${result.validEmails.length} recipients added (${result.invalidCount} invalid skipped)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
        Upload CSV
      </Button>
    </>
  );
}
