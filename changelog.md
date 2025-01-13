# Jammed API changelog

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