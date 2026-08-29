import { ShareJoin } from "./share-join";

export default async function SharedConversationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareJoin token={token} />;
}
