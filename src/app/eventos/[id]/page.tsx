import { EventDetailView } from "../../../frontend/components/event-detail";
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailView key={id} id={id} />;
}
