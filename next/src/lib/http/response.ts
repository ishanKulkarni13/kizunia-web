import { NextResponse } from "next/server";

import { HttpStatus } from "@/lib/errors";

import type { SuccessResponse } from "./response-body";

export class ApiResponse {
    static ok<T>(data: T) {
        const body: SuccessResponse<T> = {
            success: true,
            data,
        };

        return NextResponse.json(body, {
            status: HttpStatus.OK,
        });
    }

    static created<T>(data: T) {
        const body: SuccessResponse<T> = {
            success: true,
            data,
        };

        return NextResponse.json(body, {
            status: HttpStatus.CREATED,
        });
    }

    static noContent() {
        return new NextResponse(null, {
            status: 204,
        });
    }
}