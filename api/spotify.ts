export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  return Response.json({
    msg: "新版本已经生效！",
    time: Date.now()
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  });
}
