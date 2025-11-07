import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback, useEffect, useMemo, useState } from 'react'

dayjs.extend(utc)
dayjs.extend(timezone)

import type { NotificationDeliveryLog, NotificationSettings } from '../../api'
import {
  getNotificationDeliveries,
  getUserNotificationSettings,
  sendTestNotification,
  updateNotificationSettings,
} from '../../api'
import Modal from './Modal'

interface NotificationSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function NotificationSettingsModal({
  isOpen,
  onClose,
}: NotificationSettingsModalProps) {
  const timezoneOptions = useMemo<string[]>(
    () =>
      (
        Intl as unknown as { supportedValuesOf(input: string): string[] }
      ).supportedValuesOf('timeZone'),
    [],
  )
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingMorning, setTestingMorning] = useState(false)
  const [testingEvening, setTestingEvening] = useState(false)
  const [testingUpcoming, setTestingUpcoming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<NotificationDeliveryLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [settingsData, deliveryData] = await Promise.all([
        getUserNotificationSettings(),
        getNotificationDeliveries(),
      ])
      setSettings(settingsData)
      setDeliveries(deliveryData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen, loadSettings])

  const refreshDeliveries = async () => {
    try {
      setLogsLoading(true)
      const deliveryData = await getNotificationDeliveries()
      setDeliveries(deliveryData)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load delivery history',
      )
    } finally {
      setLogsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccessMessage(null)
      await updateNotificationSettings(settings)
      setSuccessMessage('Settings saved successfully!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTestNotification = async (
    type: 'morning' | 'evening' | 'upcoming',
  ) => {
    try {
      if (type === 'morning') {
        setTestingMorning(true)
      } else if (type === 'evening') {
        setTestingEvening(true)
      } else {
        setTestingUpcoming(true)
      }
      setError(null)
      setSuccessMessage(null)
      await sendTestNotification(type)
      setSuccessMessage(
        `Test ${type} notification sent! Check your configured channels.`,
      )
      setTimeout(() => setSuccessMessage(null), 5000)
      await refreshDeliveries()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to send test notification',
      )
    } finally {
      setTestingMorning(false)
      setTestingEvening(false)
      setTestingUpcoming(false)
    }
  }

  const updateChannelSetting = (
    channel: 'email' | 'ntfy' | 'webhook',
    key: string,
    value: string | boolean,
  ) => {
    if (!settings) return

    const currentChannels = settings.channels || {}
    const currentChannel = currentChannels[channel] || {}

    setSettings({
      ...settings,
      channels: {
        ...currentChannels,
        [channel]: {
          ...currentChannel,
          [key]: value,
        },
      },
    })
  }

  if (loading) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Notification Settings"
        maxWidth="700px"
      >
        <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
      </Modal>
    )
  }

  if (!settings) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Notification Settings"
        maxWidth="700px"
      >
        <div style={{ padding: '2rem', textAlign: 'center', color: '#dc3545' }}>
          {error || 'Failed to load settings'}
        </div>
      </Modal>
    )
  }

  const emailSettings = settings.channels?.email || { enabled: false }
  const ntfySettings = settings.channels?.ntfy || {
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
  }
  const webhookSettings = settings.channels?.webhook || {
    enabled: false,
    url: '',
    secret: '',
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Notification Settings"
      maxWidth="700px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && (
          <div
            style={{
              padding: '0.75rem',
              background: '#f8d7da',
              color: '#721c24',
              borderRadius: '4px',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: '0.75rem',
              background: '#d4edda',
              color: '#155724',
              borderRadius: '4px',
              fontSize: '0.9rem',
            }}
          >
            {successMessage}
          </div>
        )}

        {/* Master Toggle */}
        <div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
              style={{ cursor: 'pointer', width: '18px', height: '18px' }}
            />
            <span>Enable Notifications</span>
          </label>
          <p
            style={{
              marginTop: '0.5rem',
              fontSize: '0.85rem',
              color: '#6c757d',
            }}
          >
            Master switch to enable/disable all notifications
          </p>
        </div>

        {/* Timing Settings */}
        <div>
          <h3>Notification Times</h3>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}
              >
                Morning Tasks (HH:MM)
                <input
                  type="time"
                  value={settings.morningTime}
                  onChange={(e) =>
                    setSettings({ ...settings, morningTime: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px',
                    marginTop: '0.5rem',
                  }}
                />
              </label>
              <p
                style={{
                  marginTop: '0.25rem',
                  fontSize: '0.75rem',
                  color: '#6c757d',
                }}
              >
                Daily summary of incomplete tasks
              </p>
            </div>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}
              >
                Evening Streaks (HH:MM)
                <input
                  type="time"
                  value={settings.eveningTime}
                  onChange={(e) =>
                    setSettings({ ...settings, eveningTime: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px',
                    marginTop: '0.5rem',
                  }}
                />
              </label>
              <p
                style={{
                  marginTop: '0.25rem',
                  fontSize: '0.75rem',
                  color: '#6c757d',
                }}
              >
                Reminder for incomplete streaks
              </p>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}
              >
                Upcoming Tasks (HH:MM)
                <input
                  type="time"
                  value={settings.upcomingTasksTime}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      upcomingTasksTime: e.target.value,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px',
                    marginTop: '0.5rem',
                  }}
                />
              </label>
              <p
                style={{
                  marginTop: '0.25rem',
                  fontSize: '0.75rem',
                  color: '#6c757d',
                }}
              >
                Daily digest of upcoming events
              </p>
            </div>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                }}
              >
                Days Ahead
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.upcomingTasksDays}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      upcomingTasksDays: Number.parseInt(e.target.value) || 7,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px',
                    marginTop: '0.5rem',
                  }}
                />
              </label>
              <p
                style={{
                  marginTop: '0.25rem',
                  fontSize: '0.75rem',
                  color: '#6c757d',
                }}
              >
                Check events within this many days
              </p>
            </div>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem',
                gap: '0.5rem',
              }}
            >
              <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                Choose your IANA timezone.
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  try {
                    const detected =
                      Intl.DateTimeFormat().resolvedOptions().timeZone
                    if (detected) {
                      setSettings((prev) =>
                        prev ? { ...prev, timezone: detected } : prev,
                      )
                    }
                  } catch (err) {
                    console.error('Failed to detect timezone', err)
                  }
                }}
              >
                Use Local Timezone
              </button>
            </div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: 500,
              }}
            >
              Timezone
              <select
                value={settings.timezone}
                onChange={(e) =>
                  setSettings({ ...settings, timezone: e.target.value })
                }
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #e9ecef',
                  borderRadius: '4px',
                  marginTop: '0.5rem',
                }}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                {!timezoneOptions.includes(settings.timezone) && (
                  <option value={settings.timezone}>{settings.timezone}</option>
                )}
              </select>
            </label>
            <p
              style={{
                marginTop: '0.25rem',
                fontSize: '0.75rem',
                color: '#6c757d',
              }}
            >
              Select your IANA timezone (default: UTC)
            </p>
          </div>
        </div>

        {/* Email Channel */}
        <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '1.25rem' }}>
          <h3>Email Notifications</h3>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginTop: '0.75rem',
            }}
          >
            <input
              type="checkbox"
              checked={emailSettings.enabled}
              onChange={(e) =>
                updateChannelSetting('email', 'enabled', e.target.checked)
              }
              style={{ cursor: 'pointer' }}
            />
            <span>Enable email notifications</span>
          </label>
        </div>

        {/* ntfy Channel */}
        <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '1.25rem' }}>
          <h3>ntfy.sh Push Notifications</h3>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginTop: '0.75rem',
            }}
          >
            <input
              type="checkbox"
              checked={ntfySettings.enabled}
              onChange={(e) =>
                updateChannelSetting('ntfy', 'enabled', e.target.checked)
              }
              style={{ cursor: 'pointer' }}
            />
            <span>Enable ntfy notifications</span>
          </label>
          {ntfySettings.enabled && (
            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  ntfy Server URL
                  <input
                    type="url"
                    value={ntfySettings.server}
                    onChange={(e) =>
                      updateChannelSetting('ntfy', 'server', e.target.value)
                    }
                    placeholder="https://ntfy.sh"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      marginTop: '0.5rem',
                    }}
                  />
                </label>
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  Topic Name <span style={{ color: '#dc3545' }}>*</span>
                  <input
                    type="text"
                    value={ntfySettings.topic}
                    onChange={(e) =>
                      updateChannelSetting('ntfy', 'topic', e.target.value)
                    }
                    placeholder="my-unique-topic-name"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      marginTop: '0.5rem',
                    }}
                  />
                </label>
                <p
                  style={{
                    marginTop: '0.25rem',
                    fontSize: '0.75rem',
                    color: '#6c757d',
                  }}
                >
                  Subscribe to this topic in your ntfy mobile app to receive
                  notifications
                </p>
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  Access Token (recommended)
                  <input
                    type="password"
                    value={ntfySettings.token || ''}
                    onChange={(e) =>
                      updateChannelSetting('ntfy', 'token', e.target.value)
                    }
                    placeholder="Paste your ntfy access token"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      marginTop: '0.5rem',
                    }}
                  />
                </label>
                <p
                  style={{
                    marginTop: '0.25rem',
                    fontSize: '0.75rem',
                    color: '#6c757d',
                  }}
                >
                  Token is sent as a Bearer authorization header. Leave blank
                  for public topics.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Webhook Channel */}
        <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '1.25rem' }}>
          <h3>Webhook Integration</h3>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginTop: '0.75rem',
            }}
          >
            <input
              type="checkbox"
              checked={webhookSettings.enabled}
              onChange={(e) =>
                updateChannelSetting('webhook', 'enabled', e.target.checked)
              }
              style={{ cursor: 'pointer' }}
            />
            <span>Enable webhook notifications</span>
          </label>
          {webhookSettings.enabled && (
            <div
              style={{
                marginTop: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  Webhook URL <span style={{ color: '#dc3545' }}>*</span>
                  <input
                    type="url"
                    value={webhookSettings.url}
                    onChange={(e) =>
                      updateChannelSetting('webhook', 'url', e.target.value)
                    }
                    placeholder="https://your-webhook-endpoint.com/notifications"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      marginTop: '0.5rem',
                    }}
                  />
                </label>
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                  }}
                >
                  Secret (optional, for HMAC signature)
                  <input
                    type="password"
                    value={webhookSettings.secret || ''}
                    onChange={(e) =>
                      updateChannelSetting('webhook', 'secret', e.target.value)
                    }
                    placeholder="Optional secret for webhook signature verification"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #e9ecef',
                      borderRadius: '4px',
                      marginTop: '0.5rem',
                    }}
                  />
                </label>
                <p
                  style={{
                    marginTop: '0.25rem',
                    fontSize: '0.75rem',
                    color: '#6c757d',
                  }}
                >
                  If provided, notifications will include X-Webhook-Signature
                  header with HMAC-SHA256
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Test Notifications */}
        <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '1.25rem' }}>
          <h3>Test Notifications</h3>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#6c757d',
              marginBottom: '0.75rem',
            }}
          >
            Send test notifications to verify your channel configuration
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleTestNotification('morning')}
              disabled={testingMorning || !settings.enabled}
              className="btn btn-secondary"
              style={{ flex: '1', minWidth: '150px' }}
            >
              {testingMorning ? 'Sending...' : 'Test Morning Tasks'}
            </button>
            <button
              type="button"
              onClick={() => handleTestNotification('evening')}
              disabled={testingEvening || !settings.enabled}
              className="btn btn-secondary"
              style={{ flex: '1', minWidth: '150px' }}
            >
              {testingEvening ? 'Sending...' : 'Test Evening Streaks'}
            </button>
            <button
              type="button"
              onClick={() => handleTestNotification('upcoming')}
              disabled={testingUpcoming || !settings.enabled}
              className="btn btn-secondary"
              style={{ flex: '1', minWidth: '150px' }}
            >
              {testingUpcoming ? 'Sending...' : 'Test Upcoming Tasks'}
            </button>
          </div>
        </div>

        {/* Delivery History */}
        <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <h3 style={{ margin: 0 }}>Recent Deliveries</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={refreshDeliveries}
              disabled={logsLoading}
            >
              {logsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <p
            style={{
              fontSize: '0.8rem',
              color: '#6c757d',
              marginTop: '0.5rem',
            }}
          >
            Showing the last 50 delivery attempts across all channels.
          </p>
          {logsLoading && deliveries.length === 0 ? (
            <div style={{ padding: '0.75rem 0', fontSize: '0.85rem' }}>
              Loading history...
            </div>
          ) : deliveries.length === 0 ? (
            <div
              style={{
                padding: '0.75rem 0',
                fontSize: '0.85rem',
                color: '#6c757d',
              }}
            >
              No deliveries logged yet.
            </div>
          ) : (
            <div
              style={{
                marginTop: '0.75rem',
                border: '1px solid #e9ecef',
                borderRadius: '4px',
                maxHeight: '240px',
                overflowY: 'auto',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.85rem',
                }}
              >
                <thead>
                  <tr style={{ background: '#f8f9fa', textAlign: 'left' }}>
                    <th
                      style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #e9ecef',
                      }}
                    >
                      Time
                    </th>
                    <th
                      style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #e9ecef',
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #e9ecef',
                      }}
                    >
                      Channel
                    </th>
                    <th
                      style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #e9ecef',
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        padding: '0.5rem',
                        borderBottom: '1px solid #e9ecef',
                      }}
                    >
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => {
                    const formattedDate = settings?.timezone
                      ? dayjs
                          .utc(delivery.sentAt)
                          .tz(settings.timezone)
                          .format('DD-MMM-YY hh:mm A')
                      : dayjs
                          .utc(delivery.sentAt)
                          .local()
                          .format('DD-MMM-YY hh:mm A')
                    const statusColor =
                      delivery.status === 'sent' ? '#198754' : '#dc3545'
                    const hasError = Boolean(
                      delivery.error && delivery.error.trim() !== '',
                    )
                    return (
                      <tr key={delivery.id}>
                        <td
                          style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid #f1f3f5',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formattedDate}
                        </td>
                        <td
                          style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid #f1f3f5',
                            textTransform: 'capitalize',
                          }}
                        >
                          {delivery.type.replace('_', ' ')}
                        </td>
                        <td
                          style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid #f1f3f5',
                            textTransform: 'capitalize',
                          }}
                        >
                          {delivery.channel}
                        </td>
                        <td
                          style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid #f1f3f5',
                            color: statusColor,
                            fontWeight: 500,
                          }}
                        >
                          {delivery.status}
                        </td>
                        <td
                          style={{
                            padding: '0.5rem',
                            borderBottom: '1px solid #f1f3f5',
                            color: hasError ? '#dc3545' : '#6c757d',
                          }}
                        >
                          {hasError ? delivery.error : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
            paddingTop: '1rem',
            borderTop: '1px solid #e9ecef',
          }}
        >
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
