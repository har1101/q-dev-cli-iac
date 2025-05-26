import streamlit as st
import boto3
import json
import datetime
from typing import Dict, Any, Optional

# タイトルとページ設定
st.set_page_config(page_title="学生評価システム", layout="wide")
st.title("学生評価システム")

# セッション状態の初期化
if 'evaluation_data' not in st.session_state:
    st.session_state.evaluation_data = None

# APIエンドポイントの設定（デプロイ後に更新）
api_endpoint = "***"

# サイドバーにAWS認証情報入力フォームを追加
with st.sidebar:
    st.header("AWS認証設定")
    aws_region = st.text_input("AWS リージョン", "us-east-1")
    use_profile = st.checkbox("AWS プロファイルを使用", value=True)
    
    if use_profile:
        profile_name = st.text_input("AWS プロファイル名", "default")
        # プロファイルを使用してセッションを作成
        try:
            session = boto3.Session(profile_name=profile_name, region_name=aws_region)
        except Exception as e:
            st.error(f"AWS認証エラー: {str(e)}")
            session = None
    else:
        aws_access_key = st.text_input("AWS アクセスキー", type="password")
        aws_secret_key = st.text_input("AWS シークレットキー", type="password")
        # 認証情報を使用してセッションを作成
        try:
            session = boto3.Session(
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region
            )
        except Exception as e:
            st.error(f"AWS認証エラー: {str(e)}")
            session = None

# メイン画面のレイアウト
col1, col2 = st.columns([1, 2])

# 検索フォーム
with col1:
    st.header("学生評価データ検索")
    
    # 出席番号入力
    students_id = st.text_input("出席番号", "1")
    
    # 期間選択（年月）
    current_year = datetime.datetime.now().year
    years = list(range(current_year - 5, current_year + 1))
    months = [f"{m:02d}" for m in range(1, 13)]  # 01, 02, ..., 12 の形式
    
    col_year, col_month = st.columns(2)
    with col_year:
        selected_year = st.selectbox("年", years, index=len(years)-1)
    with col_month:
        current_month_index = datetime.datetime.now().month - 1
        selected_month = st.selectbox("月", months, index=current_month_index)
    
    # 期間フォーマット（YYYYMM）
    period = f"{selected_year}{selected_month}"
    
    # 検索ボタン
    if st.button("評価データを取得"):
        with st.spinner("データを取得中..."):
            try:
                # API Gatewayを使用してデータを取得
                if session:
                    client = session.client('apigatewaymanagementapi')
                    # 実際のAPIリクエストはboto3ではなくrequestsを使用するのが一般的
                    import requests
                    
                    # API Gatewayエンドポイントを呼び出し
                    url = f"{api_endpoint}/evaluation"
                    params = {
                        "students_id": students_id,
                        "period": period
                    }
                    
                    # AWS SigV4認証を使用してリクエストを送信
                    # 注: 実際の環境では、API GatewayのIAM認証を使用する場合は
                    # boto3のsignerを使用してリクエストに署名する必要があります
                    response = requests.get(url, params=params)
                    
                    if response.status_code == 200:
                        data = response.json()
                        st.session_state.evaluation_data = data
                        st.success("データを取得しました！")
                    else:
                        st.error(f"データ取得エラー: {response.status_code} - {response.text}")
                else:
                    # デモ用のモックデータ（AWS認証がない場合）
                    st.session_state.evaluation_data = {
                        "students_id": students_id,
                        "period": period,
                        "agent_evaluation": "これはデモ用のエージェント評価です。実際のデータはAWS認証後に取得できます。",
                        "evaluation_date": datetime.datetime.now().isoformat()
                    }
                    st.warning("デモモード: モックデータを表示しています")
            except Exception as e:
                st.error(f"エラーが発生しました: {str(e)}")

# 評価データ表示と編集
with col2:
    st.header("評価データ")
    
    if st.session_state.evaluation_data:
        data = st.session_state.evaluation_data
        
        # 基本情報の表示
        st.subheader("基本情報")
        st.write(f"**出席番号:** {data.get('students_id', '')}")
        st.write(f"**評価期間:** {data.get('period', '')}")
        st.write(f"**評価日時:** {data.get('evaluation_date', '未評価')}")
        
        # エージェント評価の表示
        st.subheader("AIエージェント評価")
        agent_eval = data.get('agent_evaluation', '評価データがありません')
        st.text_area("エージェント評価", agent_eval, height=200, disabled=True)
        
        # 教師による評価入力
        st.subheader("教師による評価")
        # teacher_evaluationが設定されていればそれを表示、なければagent_evaluationを初期値として使用
        teacher_eval = data.get('teacher_evaluation', agent_eval)
        new_teacher_eval = st.text_area("評価内容", teacher_eval, height=300)
        
        # 評価保存ボタン
        if st.button("評価を保存"):
            with st.spinner("評価を保存中..."):
                try:
                    # API Gatewayを使用してデータを更新
                    if session:
                        import requests
                        
                        # API Gatewayエンドポイントを呼び出し
                        url = f"{api_endpoint}/evaluation"
                        payload = {
                            "students_id": data.get('students_id', ''),
                            "period": data.get('period', ''),
                            "teacher_evaluation": new_teacher_eval
                        }
                        
                        # PUTリクエストを送信
                        response = requests.put(url, json=payload)
                        
                        if response.status_code == 200:
                            # 成功したら評価データを更新
                            st.session_state.evaluation_data['teacher_evaluation'] = new_teacher_eval
                            st.success("評価を保存しました！")
                        else:
                            st.error(f"保存エラー: {response.status_code} - {response.text}")
                    else:
                        st.warning("デモモード: AWS認証が必要です")
                except Exception as e:
                    st.error(f"エラーが発生しました: {str(e)}")
    else:
        st.info("出席番号と期間を入力して「評価データを取得」ボタンをクリックしてください。")

# フッター
st.markdown("---")
st.caption("© 2025 学生評価システム")
