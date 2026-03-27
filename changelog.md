# Jammed API changelog

## `2.2.0`: 24 March 2026

**ePOS API — 51 new endpoints for point-of-sale operations**

This release adds all the V2 API endpoints needed to power the Jammed ePOS app for front-of-house studio staff.

### New resources
- **Dashboard**: `GET /dashboard` — composite endpoint returning rooms, bookings, blocked times, opening time, slot length, and timezone in one call
- **Extras**: `GET /extras`, `GET /extras/{id}` — equipment and add-on items with pricing
- **Notifications**: `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/{id}/archive`, `POST /notifications/clear`
- **Blocked Times**: Full CRUD — `GET /blocked_times`, `POST /blocked_times`, `PATCH /blocked_times/{id}`, `DELETE /blocked_times/{id}`
- **Reporting**: `GET /recent_transactions`, `GET /money_ledger`

### Booking management extensions
- `DELETE /bookings/{code}` — cancel a booking
- `PATCH /bookings/{code}/uncancel` — restore cancelled booking
- `GET /bookings/search` — search by customer, room, date, code, status
- `GET /bookings/by_dates` — bookings for a date range (schedule view)
- `GET /bookings/awaiting_approval` — pending approval queue
- `POST /bookings/{code}/approve` and `POST /bookings/{code}/reject`
- `GET /bookings/{code}/pdf` — generate receipt PDF
- `POST /bookings/{code}/resend_confirmation`
- `POST /bookings/{code}/credit_notes`, `DELETE /bookings/{code}/credit_notes/{id}` — RESTful credit note management
- `POST /bookings/{code}/refund_transaction`, `POST /bookings/{code}/refunds`
- `POST /bookings/{code}/credit_payments`, `POST /bookings/{code}/credit_balances`
- `PATCH /bookings/{code}/notes` — staff notes and colour override
- `GET /bookings/{code}/notifications`
- Payment requests: create, charge, mark_as_paid, cancel
- `GET /bookings/{code}/settlement_supported`

### Customer management extensions
- `PUT /customers/{id}` — update customer details
- `GET /customers/search` — autocomplete search
- `PATCH /customers/{id}/notes`
- `GET/PATCH /customers/{id}/credit_balance`
- `GET /customers/{id}/credit_movements`
- `GET /customers/{id}/bookings`
- `GET /customers/{id}/status`
- `GET /customers/{id}/payment_methods`

### Pricing & availability
- `POST /booking_price` — real-time price calculation with extras, tax, staff
- `POST /slot_projection` — preview cost and check conflicts

### Rooms
- `GET /rooms/{id}` — room detail (extends existing index)

### New schemas
- `notification`, `blocked_time`, `extra`, `dashboard_booking`, `credit_movement`, `money_ledger_entry`, `transaction_summary`, `status_response`

## `2.1.0`: 16 March 2026

- **Added sorting and ordering support** to `GET /bookings.json` (getBookings) endpoint
- New query parameters:
  - `sort_by`: Field to sort by (`created_at`, `updated_at`, `start_at`, `end_at`, `customer_name`, `room_name`)
  - `sort_order`: Sort order (`asc` or `desc`)
  - `page`: Page number for pagination
  - `per_page`: Number of items per page (1-100, default 25)
- **Backward compatible**: Existing API calls continue to work unchanged (defaults to `created_at desc`)
- Enhanced API documentation with comprehensive parameter descriptions and examples

## `2.0.10`: 15 March 2026

- Added `PATCH /bookings/{code}.json` endpoint for updating existing bookings via the API (uses admin booking update flow)
- Added `GET /bookings/{code}/transactions.json` endpoint for retrieving all financial transactions for a booking
- Added `POST /bookings/{code}/transactions.json` endpoint for creating new transactions (credit notes) on bookings
- Added `GET /bookings/{code}/studio_notes.json` endpoint for retrieving internal studio notes for a booking
- Added `PATCH /bookings/{code}/studio_notes.json` endpoint for updating internal studio notes on bookings
- Documented new money log transaction schema with transaction details, refund status, and display formatting

## `2.0.9`: 24 February 2026

- Added `POST /bookings.json` endpoint for creating bookings via the API (uses "make booking as an admin" flow)
- Added `GET /bookings/{code}.json` endpoint for fetching a single booking by code
- Documented booking creation request body schema including `booking_details`, `customer_details`, `band_details`, `extra_ids`, and `customer_id` for existing customers

## `2.0.8`: 23 April 2025

- Added `booking.abandoned` webhook that triggers when a customer abandons their booking during checkout

## `2.0.7`: 14 March 2025

More booking fields added to the API:

- Added `custom_answers` booking responses
- Added `source_data` for how and where the booking came to be made (online/app/staff/regular etc)

## `2.0.6`: 13 January 2025

Just a few attribute additions to the API, no breaking changes

- Added `cancelled`, `online_booking` boolean to bookings
- Added `approved_at` and `rejected_at` timestamps to bookings
- Added `activity_name` string to bookings
- Added `status` enum to customers
- Added `credit_balance` integer to customers

## `2.0.5`: 6 May 2022

- Allow Coupons to be assigned Customer via API

## `2.0.4`: 5 May 2022

- Added Coupons and Promocodes API, which allows you to create and manage coupons and promocodes on Jammed

## `2.0.3`: 9 April 2022

- Added Customer creation endpoints, allowing Customers to be created via the API
- Added Customer invitation endpoint, allowing Customers to be created and invited to Jammed via the API

## `2.0.2`: 22 March 2022

- Added `duration_hours` to bookings: float duration in hours
- Added `duration_full_hours` to bookings: int duration in whole hours, rounded up to each full hour

## `2.0.1`: 9 March 2022

- Added `reminders_opt_in` and `mailing_list_opt_in` booleans to bookings, and customers

## `2.0.0`: 6 March 2022

- Initial release, published API