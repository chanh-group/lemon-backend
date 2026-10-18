import { Controller, Get } from "@nestjs/common";
import { Public } from "../../utils/decorators.js";
import { ExampleService } from "./service.js";

@Controller()
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.exampleService.getHello();
  }
}
