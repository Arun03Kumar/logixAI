"use client";
import { useSession } from "@/app/lib/auth/useSession";
import BankBrowser from "../exams/_components/BankBrowser";

/** The institution's shared question bank. Add to it from the exam editor. */
export default function QuestionBankTab({ institutionId, access, subjective }) {
  const { user } = useSession();
  const wide = access?.scope?.all ?? false;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Questions saved by anyone who sets exams here. Add them to an exam with <strong>From question bank</strong> in the
        exam editor; the exam gets its own copy.
      </p>
      <BankBrowser
        institutionId={institutionId}
        mode="manage"
        subjective={subjective}
        canDelete={(row) => wide || row.createdBy === user?.id}
      />
    </div>
  );
}
