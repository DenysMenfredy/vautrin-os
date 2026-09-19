# SDD-08 — Integration Architecture

## 1. Principle

External providers are adapters, not domain dependencies.

The domain should ask:

```text
createAppointment()
sendMessage()
getAvailability()
```

not:

```text
createGoogleCalendarEvent()
sendTwilioMessage()
```

## 2. Provider interfaces

### Messaging

```ts
interface MessagingProvider {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
```

### Calendar

```ts
interface CalendarProvider {
  getAvailability(input: AvailabilityInput): Promise<Availability[]>;
  createAppointment(input: CreateAppointmentInput): Promise<AppointmentResult>;
  cancelAppointment(input: CancelAppointmentInput): Promise<void>;
}
```

### Voice

```ts
interface VoiceProvider {
  handleCall(input: IncomingCall): Promise<CallSession>;
  transfer(input: TransferCallInput): Promise<void>;
}
```

## 3. Integration lifecycle

```text
Disconnected
   ↓
Connected
   ↓
Healthy
   ↓
Degraded
   ↓
Disconnected
```

Health state is observable.

## 4. Credentials

Provider credentials are:
- encrypted at rest where infrastructure supports it;
- never returned to the frontend;
- never placed in logs;
- scoped to tenant/integration;
- revocable.

## 5. Webhooks

Webhook handlers must:
- authenticate/verify provider signatures;
- resolve tenant;
- validate payload;
- deduplicate events;
- persist raw metadata only when appropriate;
- emit internal events.

## 6. Initial integrations

The architecture is ready for:
- telephony;
- SMS;
- email;
- Google Calendar;
- Microsoft Calendar;
- WhatsApp;
- CRM integrations.

V0.1 should implement only the minimum providers needed for the first vertical slice.

## 7. Provider portability

Switching a provider should require changing an adapter/configuration,
not domain workflows.
