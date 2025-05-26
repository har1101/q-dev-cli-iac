import boto3
from strands import Agent
from strands.models import BedrockModel

from mcp import stdio_client, StdioServerParameters
from strands.tools.mcp import MCPClient

session = boto3.Session(
    region_name="ap-northeast-1",
    #region_name="us-east-1",
    #profile_name="default",
)

# Create a Bedrock Model
bedrock_model = BedrockModel(
    #model_id="apac.anthropic.claude-3-7-sonnet-20250219-v1:0",
    model_id="apac.anthropic.claude-sonnet-4-20250514-v1:0",
    session=session,
    # cache_prompt="default",
    # cache_tools="default",
)

# stdio_mcp_client = MCPClient(lambda: stdio_client(
#     StdioServerParameters(
#         command="uvx", 
#         args=["awslabs.aws-documentation-mcp-server@latest"],
#         env={
#           "FASTMCP_LOG_LEVEL": "ERROR"
#         },
#     )
# ))

# with stdio_mcp_client:
#     # MCPのツール一覧を取得
#     tools = stdio_mcp_client.list_tools_sync()
#     print(tools)

#     # エージェントを作成
#     agent = Agent(
#         system_prompt=("""
#             あなたは優秀なAWSエンジニアです。
#             MCPを利用して、AWSの最新情報を取得してください。
#         """
#         ),
#         # プロジェクトマネージャー用の設定
#         # system_prompt=(""""
#         #     "あなたは優秀なプロジェクトマネージャーです。"
#         #     "MCPを利用して、プロジェクトの進捗状況を取得してきてください。"
#         # """),
#         tools=[tools],
#         model=bedrock_model,
#     )

#     message = """
#     Bedrockの最新モデルは何か教えて？
#     """

#     agent(message)

# エージェントを作成
agent = Agent(
    model=bedrock_model,
)

message = """
AWS Bedrockで利用可能なAnthropic Claudeの最新モデルは何ですか？
また、それぞれのモデルの特徴を教えてください。
"""

agent(message)