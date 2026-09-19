import {create}  from "zustand";

import type { CreateCompetitionInput } from "../schemas/create-competition";
import { CompetitionApi } from "../api/competition-api";
import { ApiError } from "@/lib/http";
import { toast } from "sonner";
import { AuthorizationCode } from "@/authorization";
import type { Competition } from "@/generated/prisma";

interface CreateCompetitionStore {
    loading: boolean;

    create(
        data: CreateCompetitionInput,
    ): Promise<Competition | undefined>;
}

export const useCreateCompetitionStore =
    create<CreateCompetitionStore>((set) => ({
        loading: false,

        async create(data) {
            try {
                set({ loading: true });

                const response = await CompetitionApi.create(data);

                toast.success("Competition created successfully.");

                return response.data;
            } catch(e: unknown) {
                if (e instanceof ApiError) {
                    toast.error(e.message);
                    // if(e.code === AuthorizationCode.ROLE_PERMISSION_DENIED) toast.error("ROLE PERM DENIED");
                } else {
                    toast.error("Unexpected error");
                }
            } finally {
                set({
                    loading: false,
                });
            }
        },
    }));