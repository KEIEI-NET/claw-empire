import { randomUUID } from "node:crypto";
import type { ProjectReviewReplyInput, ProjectReviewTaskChoice } from "./types.ts";

type ReviewStartBlockedTask = {
  id: string;
  title: string;
  reason: string;
  detail: string;
};

function classifyReviewHoldReason(message: string): string {
  if (message.includes("video artifact gate blocked approval")) return "video_artifact_missing";
  if (message.includes("VIDEO_FINAL_RENDER")) return "unfinished_subtasks";
  if (message.includes("unfinished subtasks")) return "unfinished_subtasks";
  if (message.includes("collaboration children")) return "collaboration_children_pending";
  return "review_gate_hold";
}

function buildVideoFinalRenderRequestTitle(lang: string): string {
  switch (lang) {
    case "ja":
      return "[VIDEO_FINAL_RENDER] 最終動画レンダリング";
    case "zh":
      return "[VIDEO_FINAL_RENDER] 最终视频渲染";
    case "ko":
      return "[VIDEO_FINAL_RENDER] 최종 영상 렌더링";
    case "en":
    default:
      return "[VIDEO_FINAL_RENDER] Final video render";
  }
}

function buildVideoFinalRenderRequestDescription(taskTitle: string, lang: string): string {
  const byLang: Record<string, string[]> = {
    ja: [
      "[VIDEO_FINAL_RENDER]",
      `上位タスク: ${taskTitle}`,
      "すべてのドキュメント/協業成果物を取りまとめ、最終紹介動画を1回レンダリングしてください。",
      "最終レンダリングエンジンは必ずRemotionのみを使用してください。Python（moviepy/Pillow）ベースのレンダリングは禁止です。",
      "成果物パス規則（project_department_final.mp4）を守り、結果ファイルのパス/容量の検証を報告してください。",
      "",
      "[QUALITY]",
      "- 目標尺55〜65秒、8〜12ショット以上で構成",
      "- 冒頭2〜4秒はブランド/マスコットのキービジュアルイントロ",
      "- 静止シーンの3秒超過禁止、ショットごとにモーション（カメラ/テキスト/レイアウト）を分離",
      "- 字幕/テキストのsafe area（左右8%、上下10%）を遵守",
      "- 結果報告に秒単位のシーンタイムラインと品質チェックリストを含める",
    ],
    en: [
      "[VIDEO_FINAL_RENDER]",
      `Parent task: ${taskTitle}`,
      "Gather all documents/collaboration artifacts and render the final intro video once.",
      "The final render engine MUST be Remotion only. Python (moviepy/Pillow) based rendering is forbidden.",
      "Follow the artifact path rule (project_department_final.mp4) and report the output file path/size verification.",
      "",
      "[QUALITY]",
      "- Target length 55-65s, composed of 8-12 shots or more",
      "- First 2-4s is a brand/mascot key-visual intro",
      "- No static scene over 3s; separate per-shot motion (camera/text/layout)",
      "- Respect subtitle/text safe area (8% sides, 10% top/bottom)",
      "- Include a second-by-second scene timeline and quality checklist in the report",
    ],
    zh: [
      "[VIDEO_FINAL_RENDER]",
      `上级任务: ${taskTitle}`,
      "汇总所有文档/协作产出，渲染一次最终介绍视频。",
      "最终渲染引擎必须仅使用 Remotion。禁止基于 Python（moviepy/Pillow）的渲染。",
      "遵守产出路径规则（project_department_final.mp4），并报告结果文件路径/大小的验证。",
      "",
      "[QUALITY]",
      "- 目标时长 55~65 秒，由 8~12 个镜头以上组成",
      "- 开头 2~4 秒为品牌/吉祥物主视觉片头",
      "- 静态画面不超过 3 秒，按镜头分离运动（镜头/文字/布局）",
      "- 遵守字幕/文字安全区（左右 8%，上下 10%）",
      "- 报告中包含逐秒场景时间轴与质量检查清单",
    ],
    ko: [
      "[VIDEO_FINAL_RENDER]",
      `상위 업무: ${taskTitle}`,
      "모든 문서/협업 산출물을 취합해 최종 소개 영상을 1회 렌더링하세요.",
      "최종 렌더링 엔진은 반드시 Remotion만 사용하세요. Python(moviepy/Pillow) 기반 렌더링은 금지됩니다.",
      "산출물 경로 규칙(project_department_final.mp4)을 지키고, 결과 파일 경로/용량 검증을 보고하세요.",
      "",
      "[QUALITY]",
      "- 목표 길이 55~65초, 8~12 샷 이상 구성",
      "- 시작 2~4초는 브랜드/마스코트 키비주얼 인트로",
      "- 정적인 장면 3초 초과 금지, 샷별 모션(카메라/텍스트/레이아웃) 분리",
      "- 자막/텍스트 safe area(좌우 8%, 상하 10%) 준수",
      "- 결과 보고에 초 단위 씬 타임라인과 품질 체크리스트 포함",
    ],
  };
  return (byLang[lang] ?? byLang.en).join("\n");
}

export function handleProjectReviewDecisionReply(input: ProjectReviewReplyInput): boolean {
  const { req, res, currentItem, selectedOption, optionNumber, deps } = input;
  if (currentItem.kind !== "project_review_ready") return false;

  const {
    db,
    appendTaskLog,
    nowMs,
    normalizeTextField,
    getPreferredLanguage,
    pickL,
    l,
    broadcast,
    finishReview,
    getProjectReviewDecisionState,
    recordProjectReviewDecisionEvent,
    getProjectReviewTaskChoices,
    openSupplementRound,
    processSubtaskDelegations,
    PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX,
  } = deps;

  const projectId = currentItem.project_id;
  if (!projectId) {
    res.status(400).json({ error: "project_id_required" });
    return true;
  }
  const selectedAction = selectedOption.action;
  const decisionSnapshotHash = getProjectReviewDecisionState(projectId)?.snapshot_hash ?? null;

  if (selectedAction === "keep_waiting") {
    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "keep_waiting",
    });
    return true;
  }

  if (selectedAction.startsWith("approve_task_review:")) {
    const selectedTaskId = selectedAction.slice("approve_task_review:".length).trim();
    if (!selectedTaskId) {
      res.status(400).json({ error: "task_id_required" });
      return true;
    }
    const targetTask = db
      .prepare(
        `
        SELECT id, title
        FROM tasks
        WHERE id = ?
          AND project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
      `,
      )
      .get(selectedTaskId, projectId) as { id: string; title: string } | undefined;
    if (!targetTask) {
      res.status(404).json({ error: "project_review_task_not_found" });
      return true;
    }

    appendTaskLog(
      targetTask.id,
      "system",
      `${PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX} (project_id=${projectId}, option=${optionNumber})`,
    );
    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "representative_pick",
      summary: `대표 선택: ${targetTask.title}`,
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || targetTask.title,
          task_id: targetTask.id,
        },
      ]),
      task_id: targetTask.id,
    });
    const remaining = getProjectReviewTaskChoices(projectId).filter(
      (task: ProjectReviewTaskChoice) => !task.selected,
    ).length;
    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "approve_task_review",
      task_id: targetTask.id,
      pending_task_choices: remaining,
    });
    return true;
  }

  if (selectedAction === "add_followup_request") {
    const note = normalizeTextField(req.body?.note);
    if (!note) {
      res.status(400).json({ error: "followup_note_required" });
      return true;
    }
    const lang = getPreferredLanguage();
    const followupTitlePrefix = pickL(
      l(["[의사결정 추가요청]"], ["[Decision Follow-up]"], ["[意思決定追加要請]"], ["[决策追加请求]"]),
      lang,
    );
    const targetTaskIdInput = normalizeTextField(req.body?.target_task_id);
    const targetTask = targetTaskIdInput
      ? (db
          .prepare(
            `
            SELECT id, title, status, assigned_agent_id, department_id
            FROM tasks
            WHERE id = ?
              AND project_id = ?
              AND status = 'review'
              AND source_task_id IS NULL
          `,
          )
          .get(targetTaskIdInput, projectId) as
          | {
              id: string;
              title: string;
              status: string;
              assigned_agent_id: string | null;
              department_id: string | null;
            }
          | undefined)
      : undefined;
    const fallbackTargetTask = db
      .prepare(
        `
        SELECT id, title, status, assigned_agent_id, department_id
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `,
      )
      .get(projectId) as
      | {
          id: string;
          title: string;
          status: string;
          assigned_agent_id: string | null;
          department_id: string | null;
        }
      | undefined;
    const resolvedTarget = targetTask ?? fallbackTargetTask;
    if (!resolvedTarget) {
      res.status(404).json({ error: "project_review_task_not_found" });
      return true;
    }

    const subtaskId = randomUUID();
    const createdAt = nowMs();
    const noteCompact = note.replace(/\s+/g, " ").trim();
    const noteTitle = noteCompact.length > 72 ? `${noteCompact.slice(0, 69).trimEnd()}...` : noteCompact;
    const title = `${followupTitlePrefix} ${noteTitle}`;
    db.prepare(
      `
        INSERT INTO subtasks (id, task_id, title, description, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `,
    ).run(subtaskId, resolvedTarget.id, title, note, createdAt);

    appendTaskLog(resolvedTarget.id, "system", `Decision inbox follow-up request added: ${note}`);
    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "followup_request",
      summary: selectedOption.label || "추가요청 입력",
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || "add_followup_request",
          task_id: resolvedTarget.id,
        },
      ]),
      note,
      task_id: resolvedTarget.id,
    });
    const insertedSubtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId);
    broadcast("subtask_update", insertedSubtask);

    const supplement = openSupplementRound(
      resolvedTarget.id,
      resolvedTarget.assigned_agent_id,
      resolvedTarget.department_id,
      "Decision inbox",
    );

    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "add_followup_request",
      task_id: resolvedTarget.id,
      subtask_id: subtaskId,
      supplement_round_started: supplement.started,
      supplement_round_reason: supplement.reason,
    });
    return true;
  }

  if (selectedAction === "start_project_review") {
    const reviewTaskChoices = getProjectReviewTaskChoices(projectId);
    const requiresRepresentativeSelection = reviewTaskChoices.length > 1;
    const pendingChoices = requiresRepresentativeSelection
      ? reviewTaskChoices.filter((task: ProjectReviewTaskChoice) => !task.selected)
      : [];
    if (requiresRepresentativeSelection && pendingChoices.length > 0) {
      res.status(409).json({
        error: "project_task_options_pending",
        pending_task_choices: pendingChoices.map((task: ProjectReviewTaskChoice) => ({
          id: task.id,
          title: task.title,
        })),
      });
      return true;
    }

    const readiness = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS active_total,
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') AND status = 'review' THEN 1 ELSE 0 END) AS active_review
        FROM tasks
        WHERE project_id = ?
      `,
      )
      .get(projectId) as { active_total: number | null; active_review: number | null } | undefined;
    const activeTotal = readiness?.active_total ?? 0;
    const activeReview = readiness?.active_review ?? 0;
    if (!(activeTotal > 0 && activeTotal === activeReview)) {
      res.status(409).json({
        error: "project_not_ready_for_review_meeting",
        active_total: activeTotal,
        active_review: activeReview,
      });
      return true;
    }

    const reviewTasks = db
      .prepare(
        `
        SELECT id, title, workflow_pack_key, assigned_agent_id, department_id
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC
      `,
      )
      .all(projectId) as Array<{
      id: string;
      title: string;
      workflow_pack_key: string | null;
      assigned_agent_id: string | null;
      department_id: string | null;
    }>;

    const blockedTasks: ReviewStartBlockedTask[] = [];
    const startedTaskIds: string[] = [];
    for (const task of reviewTasks) {
      const beforeLog = db
        .prepare("SELECT COALESCE(MAX(created_at), 0) AS max_created_at FROM task_logs WHERE task_id = ?")
        .get(task.id) as { max_created_at?: number } | undefined;
      const baselineLogTs = Number(beforeLog?.max_created_at ?? 0);
      appendTaskLog(task.id, "system", "Decision inbox: project-level review meeting approved by CEO");
      finishReview(task.id, task.title, {
        bypassProjectDecisionGate: true,
        trigger: "decision_inbox",
      });

      const afterTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as
        | { status?: string }
        | undefined;
      if (afterTask?.status !== "review") {
        startedTaskIds.push(task.id);
        continue;
      }
      const holdLog = db
        .prepare(
          `
          SELECT message
          FROM task_logs
          WHERE task_id = ?
            AND kind = 'system'
            AND created_at >= ?
            AND message LIKE 'Review hold:%'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        )
        .get(task.id, baselineLogTs) as { message?: string | null } | undefined;
      const holdMessage = String(holdLog?.message ?? "").trim();
      if (!holdMessage) {
        // Consensus meeting starts asynchronously; keep as started unless a hold signal is emitted.
        startedTaskIds.push(task.id);
        continue;
      }
      blockedTasks.push({
        id: task.id,
        title: task.title,
        reason: classifyReviewHoldReason(holdMessage),
        detail: holdMessage,
      });
    }

    if (blockedTasks.length > 0) {
      const lang = getPreferredLanguage();
      for (const blocked of blockedTasks) {
        if (blocked.reason !== "video_artifact_missing" && blocked.reason !== "unfinished_subtasks") continue;
        const taskRow = reviewTasks.find((task) => task.id === blocked.id);
        if (!taskRow || taskRow.workflow_pack_key !== "video_preprod") continue;
        const existingRenderSubtask = db
          .prepare(
            `
            SELECT id
                 , status
            FROM subtasks
            WHERE task_id = ?
              AND title LIKE '%[VIDEO_FINAL_RENDER]%'
            ORDER BY created_at DESC
            LIMIT 1
          `,
          )
          .get(taskRow.id) as { id?: string; status?: string } | undefined;
        if (existingRenderSubtask?.id) {
          appendTaskLog(
            taskRow.id,
            "system",
            `Decision inbox: skipped final render subtask auto-create (existing id=${existingRenderSubtask.id}, status=${existingRenderSubtask.status ?? "unknown"})`,
          );
          continue;
        }

        const subtaskId = randomUUID();
        const createdAt = nowMs();
        const renderTitle = buildVideoFinalRenderRequestTitle(lang);
        const renderDescription = buildVideoFinalRenderRequestDescription(taskRow.title, lang);
        db.prepare(
          `
            INSERT INTO subtasks (id, task_id, title, description, status, target_department_id, created_at)
            VALUES (?, ?, ?, ?, 'pending', 'dev', ?)
          `,
        ).run(subtaskId, taskRow.id, renderTitle, renderDescription, createdAt);
        appendTaskLog(taskRow.id, "system", "Decision inbox: auto-created final render subtask (target=dev)");
        const insertedSubtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId);
        broadcast("subtask_update", insertedSubtask);
        processSubtaskDelegations?.(taskRow.id, { includeRender: true });
      }

      const blockedTitles = blockedTasks.map((task) => task.title).join(", ");
      const blockedSummary =
        lang === "ja"
          ? `チームリーダー会議の開始を保留（${blockedTasks.length}件）: ${blockedTitles}`
          : lang === "zh"
            ? `团队负责人会议开始被搁置（${blockedTasks.length}项）: ${blockedTitles}`
            : lang === "ko"
              ? `팀장 회의 시작 보류 (${blockedTasks.length}건): ${blockedTitles}`
              : `Team lead meeting start on hold (${blockedTasks.length}): ${blockedTitles}`;
      recordProjectReviewDecisionEvent({
        project_id: projectId,
        snapshot_hash: decisionSnapshotHash,
        event_type: "start_review_meeting_blocked",
        summary: blockedSummary,
        selected_options_json: JSON.stringify([
          {
            number: optionNumber,
            action: selectedAction,
            label: selectedOption.label || "start_project_review",
            task_count: reviewTasks.length,
            blocked_count: blockedTasks.length,
          },
        ]),
        note: blockedTasks.map((task) => `${task.title}: ${task.detail}`).join("\n"),
      });
      res.json({
        ok: true,
        resolved: false,
        kind: "project_review_ready",
        action: "start_project_review_blocked",
        started_task_ids: startedTaskIds,
        blocked_tasks: blockedTasks,
      });
      return true;
    }

    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "start_review_meeting",
      summary: selectedOption.label || "팀장 회의 진행",
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || "start_project_review",
          task_count: reviewTasks.length,
        },
      ]),
    });

    res.json({
      ok: true,
      resolved: true,
      kind: "project_review_ready",
      action: "start_project_review",
      started_task_ids: startedTaskIds,
    });
    return true;
  }

  res.status(400).json({ error: "unsupported_project_action", action: selectedAction });
  return true;
}
