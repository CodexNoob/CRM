"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { requireClientActor } from "@/lib/auth/current";
import { setTaskStatus } from "@/services/tasks";

export async function completeClientTaskAction(taskId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const actor = await requireClientActor();
  try {
    await setTaskStatus(getDb(), actor, taskId, "completed");
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/portal");
  return { status: "success" };
}
