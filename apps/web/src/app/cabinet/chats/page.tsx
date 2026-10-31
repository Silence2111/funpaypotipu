import { redirect } from 'next/navigation';

/** Диалоги переехали в мессенджер. */
export default function ChatsRedirect() {
  redirect('/chat');
}
