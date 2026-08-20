import { OperationalApp } from "./_components/operational-app";

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <OperationalApp>{children}</OperationalApp>;
}
