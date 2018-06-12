# Bugs

- Webhook verification doesn't work because the signature doesn't match. I gave up solving the problem because it works fine when actual Line users send messages.

# Problems

- Timezone list might not be up-to-date because it is statically defined in the script.
    It might be better to create a DB table for it, but I wanna keep the cost for DynamoDB as low as possible.

# Todo

- Delete redundant information in end string
- Whitelist the IP address
- When the location information is sent, return the official timezone name of that location

# References

- https://qiita.com/n0bisuke/items/56d7ace2193fbc106639#webhook-event-object
    Do I need to specify the content length?
- https://dev.classmethod.jp/etc/lambda-line-bot-tutorial/
    Refer to this page when transferring this to Amazon Lambda

DB

chats: {
    users: [
        {
            userId: 'AAA',
            timezones: [
                {
                    timezone: 'Asia/Tokyo',
                    alias: 'jst'
                },
                ...
            ]
        },
        ...
    ],
    groups: [
        {
            groupId: 'AAA',
            timezones: []
        }
    ],
    rooms: [
        {
            roomId: 'AAA'
            timezones: []
        }
    ]
}