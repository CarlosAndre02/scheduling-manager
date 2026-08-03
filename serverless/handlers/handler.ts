import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

export const handler = async (
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello World" }),
  };
};

// Allow running this file locally via `npm run start` / `npm run dev`.
// if (require.main === module) {
//   handler({} as unknown as APIGatewayProxyEvent)
//     .then((res) => console.log(res))
//     .catch((err) => {
//       console.error(err);
//       process.exitCode = 1;
//     });
// }
