"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { errorState, type ActionState } from "@/lib/action-state";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "@/lib/auth/current";
import { login } from "@/lib/auth/login";
import { createSession, invalidateSession } from "@/lib/auth/sessions";
import { createFirstAdmin } from "@/services/setup";
import { ValidationError } from "@/lib/errors";
import { acceptInvitation } from "@/services/users";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const result = await login(getDb(), { email: formData.get("email"), password: formData.get("password") });
    await setSessionCookie(result.token);
    destination = result.actor.role === "client" ? "/portal" : "/staff";
  } catch (error) {
    return errorState(error, formData);
  }
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();
  if (token) await invalidateSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

export async function firstRunSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const field = (k: string) => (typeof formData.get(k) === "string" ? (formData.get(k) as string) : "");
    const actor = await createFirstAdmin(
      getDb(),
      {
        name: field("name"),
        email: field("email"),
        password: field("password"),
        confirmPassword: field("confirmPassword"),
        setupCode: field("setupCode"),
      },
      process.env.SETUP_CODE,
    );
    const { token } = await createSession(getDb(), actor.userId);
    await setSessionCookie(token);
  } catch (error) {
    // errorState never echoes passwords or the setup code back to the browser.
    return errorState(error, formData);
  }
  redirect("/staff/team?welcome=1");
}

export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const password = formData.get("password");
    if (password !== formData.get("confirmPassword")) {
      throw new ValidationError({ confirmPassword: ["Passwords do not match."] });
    }
    await acceptInvitation(getDb(), String(formData.get("token") ?? ""), password);
  } catch (error) {
    return errorState(error);
  }
  redirect("/login?setup=done");
}
