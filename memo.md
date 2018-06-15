# Bugs

- Webhook verification doesn't work because the signature doesn't match. I gave up solving the issue because it works fine when actual Line users send messages.

# Todo

- Suggestion and Japanese translation are not reflected to the code on Cloud9
- When the location information is sent, return the official timezone name of that location

# DB Structure

- Hash key: Id
- Sort key: ChatType (either 'user', 'group', or 'room')
- Attribute: Timezones (a JSON object with two keys: timezone and alias)