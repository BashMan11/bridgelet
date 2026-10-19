import { create } from 'zustand';
import { JOURNEYS, track } from '../analytics/analytics';

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    title: 'New message received',
    body: 'You have a new message from Alex.',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    id: '2',
    title: 'Your order has shipped',
    body: 'Order #4821 is on its way.',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: '3',
    title: 'Payment confirmed',
    body: 'Your payment of $49.99 was successful.',
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
  },
  {
    id: '4',
    title: 'Reminder: Meeting at 3pm',
    body: "Don't forget your scheduled call.",
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
  },
];

const countUnread = (notifications: Notification[]) =>
  notifications.filter((n) => !n.read).length;

/**
 * Coarse category for a notification.
 *
 * The store deliberately carries no notification id into analytics: ids are
 * per-install and would turn an engagement metric into a user-level one. The
 * category is enough to answer "do notifications drive engagement?", which is
 * what the event is for.
 */
function notificationType(notification: Notification | undefined): string {
  if (!notification) return 'unknown';
  const title = notification.title.toLowerCase();
  if (title.includes('payment') || title.includes('claim')) return 'payment';
  if (title.includes('message')) return 'message';
  return 'general';
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: MOCK_NOTIFICATIONS,
  unreadCount: countUnread(MOCK_NOTIFICATIONS),

  markAsRead: (id) => {
    const target = get().notifications.find((n) => n.id === id);
    const unreadBefore = get().unreadCount;
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      return { notifications: updated, unreadCount: countUnread(updated) };
    });
    // Analytics live outside the state updater: an updater must stay pure, and
    // a thrown analytics error inside `set()` would leave the store in an
    // inconsistent state.
    track({
      name: 'Notification Opened',
      params: { journey: JOURNEYS.shared, notification_type: notificationType(target) },
    });
    const unreadAfter = get().unreadCount;
    if (unreadBefore > 0 && unreadAfter === 0) {
      track({
        name: 'Notifications Cleared',
        params: { journey: JOURNEYS.shared, source: 'last_read', unread_before: unreadBefore },
      });
    }
  },

  markAllAsRead: () => {
    const unreadBefore = get().unreadCount;
    if (unreadBefore === 0) return;
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
    track({
      name: 'Notifications Cleared',
      params: { journey: JOURNEYS.shared, source: 'read_all', unread_before: unreadBefore },
    });
  },
}));