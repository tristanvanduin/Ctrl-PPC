import { CodeRoodDossier } from "@/components/dashboard/code-rood-dossier";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function CodeRoodDossierPage({ params }: Props) {
  const { clientId } = await params;
  return <CodeRoodDossier clientId={clientId} />;
}
