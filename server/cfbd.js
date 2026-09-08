const CFBD_GQL = 'https://graphql.collegefootballdata.com/v1/graphql';

// Executes a CFBD GraphQL query. Accepts an optional variables object.
// Returns the `data` object from the response, or throws on HTTP error or GraphQL errors.
export async function cfbdGql(query, variables = {}, env) {
    const res = await fetch(CFBD_GQL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': env.CFBD_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`CFBD GraphQL HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
}