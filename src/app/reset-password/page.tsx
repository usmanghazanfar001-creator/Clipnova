import { Suspense } from "react";
import { ResetForm } from "@/components/AuthForms";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
